import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import {
  claimOnboardingStepJobs,
  kickOnboardingStepWork,
  processOnboardingStepJob
} from '$lib/server/onboarding-steps';

// Research can approach the 300s platform cap; keep the worker at that ceiling.
export const config = { maxDuration: 300 };

const BATCH_SIZE = 2;

/**
 * Stop CLAIMING after 30s, not after 270s. A claimed job owns the rest of this invocation's 300s;
 * claim one at t=269s and the platform kills it seconds later, leaving the row `running` and
 * unusable until the stall window expires — having burned an attempt for nothing. Whatever is left
 * pending is picked up by the re-kick below (a fresh 300s) or the two-minute cron.
 */
const CLAIM_DEADLINE_MS = 30_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

async function run(request: Request, platform: Platform): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const origin = new URL(request.url).origin;

  let processed = 0;
  let failed = 0;
  const startedAt = Date.now();
  // Jobs this invocation already ran — a retry must not be re-claimed here (see claimOnboardingStepJobs).
  const seen = new Set<string>();

  while (Date.now() - startedAt < CLAIM_DEADLINE_MS) {
    const ids = await claimOnboardingStepJobs(admin, BATCH_SIZE, seen);
    if (!ids.length) break;
    for (const id of ids) seen.add(id);

    const results = await Promise.allSettled(
      ids.map((id) => processOnboardingStepJob(admin, id))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') processed++;
      else {
        failed++;
        console.error('[onboarding/steps/work]', r.reason);
      }
    }
  }

  const { count: remaining } = await admin
    .from('onboarding_step_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  if ((remaining ?? 0) > 0) {
    if (platform?.context?.waitUntil) platform.context.waitUntil(kickOnboardingStepWork(origin));
    else void kickOnboardingStepWork(origin);
  }

  return new Response(
    JSON.stringify({ ok: true, processed, failed, remaining: remaining ?? 0 }),
    { headers: { 'content-type': 'application/json' } }
  );
}

export const GET: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
export const POST: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
