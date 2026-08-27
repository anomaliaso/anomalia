import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { cronAuthorized } from '$lib/server/cron-auth';
import { drainChatQueue } from '$lib/server/chat/queue';

// Matches the chat route: a drain runs whole turns, so it needs the same ceiling they do.
export const config = { maxDuration: 1800 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

const run = (request: Request, platform: Platform, reap: boolean) => {
	if (!cronAuthorized(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const origin = new URL(request.url).origin;
	const work = drainChatQueue({ origin, maxJobs: 2, reap });
	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(work);
		return json({ started: true });
	}
	return work.then((r) => json(r));
};

// POST: the inline kick after a turn ends — drains only, it fires far too often to sweep on.
export const POST: RequestHandler = ({ request, platform }) =>
	run(request, platform as Platform, false);

// GET: the cron. Also the only sweep that closes dead turns for users who are not looking at
// their chat right now — without it a zombie row keeps claiming "still generating".
export const GET: RequestHandler = ({ request, platform }) =>
	run(request, platform as Platform, true);
