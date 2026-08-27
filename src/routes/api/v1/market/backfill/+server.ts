import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { backfillFromHistory } from '$lib/server/market-harvest';

export const config = { maxDuration: 800 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

/**
 * POST /api/v1/market/backfill — seed the pool from social_post_history.
 *
 * One-shot, deliberately NOT a cron: it exists to get the fit off zero on day one. Discovery needs
 * an account to recur several times before any of its posts can be labelled, so the open-web pool is
 * unusable for days; history is already grouped one-account-per-group and labels thousands of posts
 * at once, for no API calls at all.
 *
 * Idempotent — rows upsert on (platform, external_id) behind a `seed:` prefix, so running it twice
 * refreshes rather than duplicates.
 */
function run(request: Request, platform: Platform): Response {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? '') || undefined;

  const work = (async () => {
    try {
      const result = await backfillFromHistory(createAdminClient(), { limit });
      console.log('[market/backfill]', JSON.stringify(result));
    } catch (e) {
      console.error('[market/backfill]', e instanceof Error ? e.message : e);
    }
  })();

  if (platform?.context?.waitUntil) platform.context.waitUntil(work);
  else void work;
  return json({ ok: true, started: true }, { status: 202 });
}

export const GET: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
export const POST: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
