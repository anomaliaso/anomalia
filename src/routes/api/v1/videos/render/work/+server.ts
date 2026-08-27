import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { reconcileVideoRenders } from '$lib/server/video-render-queue';

// A tick is a handful of recordInfo calls plus, at most, a few mp4 downloads. It never waits on a
// render — that is the entire point of this route existing.
export const config = { maxDuration: 300 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

const run = (request: Request, platform: Platform) => {
  if (!cronAuthorized(request)) return json({ error: 'Unauthorized' }, { status: 401 });
  const work = reconcileVideoRenders(createAdminClient(), {
    origin: new URL(request.url).origin
  }).catch((e) => {
    console.error('[video-render] tick failed', e);
    return { checked: 0, done: 0, failed: 0, expired: 0 };
  });
  if (platform?.context?.waitUntil) {
    platform.context.waitUntil(work);
    return json({ started: true });
  }
  return work.then((r) => json(r));
};

export const GET: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
export const POST: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
