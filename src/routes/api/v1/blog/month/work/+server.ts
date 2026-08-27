import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { advanceBlogMonthJob, claimBlogMonthJobs, kickBlogMonthWork } from '$lib/server/blog-month';

// Advances "Pianifica il mese" jobs one step per invocation (write a chunk of articles → submit the
// image batch → collect it). Mirrors knowledge/work: cron */2 as the backstop, self-chaining while
// there is still work, and a time budget under the function cap.
export const config = { maxDuration: 300 };

const TIME_BUDGET_MS = 240_000;
const JOBS_PER_PASS = 2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

async function run(request: Request, platform: Platform): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const origin = new URL(request.url).origin;

  let advanced = 0;
  let moreWork = false;
  const startedAt = Date.now();

  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    const jobs = await claimBlogMonthJobs(admin, JOBS_PER_PASS);
    if (!jobs.length) break;
    const results = await Promise.allSettled(jobs.map((j) => advanceBlogMonthJob(admin, j)));
    // Recomputed EVERY pass, deliberately: a sticky flag would keep the loop alive after the writing
    // finished, re-claiming the now-'imaging' job and hammering batches.get for the whole budget.
    let progressed = false;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        advanced++;
        if (r.value) progressed = true;
      } else {
        console.error('[blog/month/work]', r.reason);
      }
    }
    moreWork = progressed;
    // A job waiting on the image provider returns false: end the pass instead of spinning on a poll.
    // The cron picks it back up in 2 minutes.
    if (!progressed) break;
  }

  if (moreWork) {
    if (platform?.context?.waitUntil) platform.context.waitUntil(kickBlogMonthWork(origin));
    else void kickBlogMonthWork(origin);
  }

  return new Response(JSON.stringify({ ok: true, advanced, moreWork }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
export const POST: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
