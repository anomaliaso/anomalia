import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { kickKnowledgeWork } from '$lib/server/knowledge';
import {
  claimPendingSources,
  knowledgeConnectorsEnabled,
  syncKnowledgeSource
} from '$lib/server/knowledge-sources';

export const config = { maxDuration: 300 };

type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

async function run(request: Request, platform: Platform): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!knowledgeConnectorsEnabled()) {
    return new Response(JSON.stringify({ ok: true, skipped: 'composio-unconfigured' }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  const admin = createAdminClient();
  const origin = new URL(request.url).origin;
  const ids = await claimPendingSources(admin, 2);
  let synced = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await syncKnowledgeSource(admin, id, origin);
      synced++;
    } catch (e) {
      failed++;
      console.error('[knowledge/sources/work]', e);
    }
  }

  if (synced > 0) {
    if (platform?.context?.waitUntil) platform.context.waitUntil(kickKnowledgeWork(origin));
    else void kickKnowledgeWork(origin);
  }

  return new Response(JSON.stringify({ ok: true, claimed: ids.length, synced, failed }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
export const POST: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
