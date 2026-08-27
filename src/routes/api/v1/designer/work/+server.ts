import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { drainDesignerQueue } from '$lib/server/designer-work';

// Must match CHAT_MAX_DURATION_MS: designer-work.ts builds its deadline from chatTurnDeadline()
// and its hard abort from CHAT_TURN_ABORT_MS, both carved out of that wall. At 300s neither fired
// before the platform kill, so enqueueDesignerContinuation never ran and the resume chain broke.
export const config = { maxDuration: 1800 };

type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

const run = (request: Request, platform: Platform, reap: boolean) => {
	if (!cronAuthorized(request)) return json({ error: 'Unauthorized' }, { status: 401 });
	const origin = new URL(request.url).origin;
	const admin = createAdminClient();
	const work = drainDesignerQueue({ admin, origin, maxJobs: 1, reap });
	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(work);
		return json({ started: true });
	}
	return work.then((r) => json(r));
};

export const POST: RequestHandler = ({ request, platform }) =>
	run(request, platform as Platform, false);

export const GET: RequestHandler = ({ request, platform }) =>
	run(request, platform as Platform, true);
