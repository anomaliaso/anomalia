import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import {
  backfillChunkEmbeddings,
  claimPendingDocuments,
  kickKnowledgeWork,
  processDocument
} from '$lib/server/knowledge';

export const config = { maxDuration: 300 };

const BATCH_SIZE = 3;
const TIME_BUDGET_MS = 270_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

async function run(request: Request, platform: Platform): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const origin = new URL(request.url).origin;

  let processed = 0;
  let failed = 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    const ids = await claimPendingDocuments(admin, BATCH_SIZE);
    if (!ids.length) break;

    const results = await Promise.allSettled(ids.map((id) => processDocument(admin, id)));
    for (const r of results) {
      if (r.status === 'fulfilled') processed++;
      else {
        failed++;
        console.error('[knowledge/work]', r.reason);
      }
    }
  }

  let embedded = 0;
  if (Date.now() - startedAt < TIME_BUDGET_MS) {
    try {
      embedded = await backfillChunkEmbeddings(admin, 64);
    } catch (e) {
      console.error('[knowledge/work] embed backfill', e);
    }
  }

  const { count: remaining } = await admin
    .from('brand_documents')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .neq('kind', 'image');

  if ((remaining ?? 0) > 0) {
    if (platform?.context?.waitUntil) platform.context.waitUntil(kickKnowledgeWork(origin));
    else void kickKnowledgeWork(origin);
  }

  return new Response(
    JSON.stringify({ ok: true, processed, failed, embedded, remaining: remaining ?? 0 }),
    { headers: { 'content-type': 'application/json' } }
  );
}

export const GET: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
export const POST: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
