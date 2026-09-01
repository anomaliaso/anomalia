/**
 * Long-lived chat worker.
 *
 * Everything the serverless deployment does to survive a 300s function wall — capping a turn at
 * 235s, aborting it at 265s, splitting the leftover into a queued continuation, self-chaining the
 * drain over HTTP — exists because the process running a turn is about to be killed. This process
 * is not, so a turn here can simply take as long as the work takes.
 *
 * The queue itself is unchanged: same `chat_jobs` table, same `drainChatQueue`, same rows the
 * Vercel cron drains today. The two can run side by side — whoever claims a row first gets it —
 * which is what makes this safe to roll out and safe to turn off again.
 */
import { drainChatQueue } from '$lib/server/chat/queue';
import { textRouteLabel } from '$lib/server/xiaomi';

/** Nothing to do → wait this long before asking again. The queue is a table, not a firehose. */
const IDLE_POLL_MS = Number(process.env.WORKER_IDLE_POLL_MS ?? 2_000);
/** Jobs per lap before looping back round to the reap. */
const BATCH = Number(process.env.WORKER_BATCH ?? 3);
/** How often to sweep dead rows. The reap is a scan across every user — not worth doing per lap. */
const REAP_EVERY_MS = Number(process.env.WORKER_REAP_EVERY_MS ?? 60_000);

const ORIGIN = process.env.PUBLIC_APP_URL ?? process.env.ORIGIN ?? '';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let stopping = false;
let draining = false;

/**
 * Finish the lap in flight, then exit. A turn killed mid-write leaves a `running` row with a stale
 * heartbeat — recoverable (the reaper closes it) but it costs the user their answer, so on a
 * routine restart we would rather wait. A second signal means the platform is not asking.
 */
function requestStop(signal: string) {
	if (stopping) {
		console.warn(`[worker] ${signal} again — exiting now`);
		process.exit(1);
	}
	stopping = true;
	console.log(`[worker] ${signal} — finishing the current lap, then exiting`);
	if (!draining) process.exit(0);
}

process.on('SIGTERM', () => requestStop('SIGTERM'));
process.on('SIGINT', () => requestStop('SIGINT'));

// A crash takes the whole loop down and loses every job it would have drained. Log loudly and keep
// going: the alternative is a silent worker, and a job that genuinely cannot be processed is
// already handled by the per-job error path inside processNextQueuedChatJob.
process.on('unhandledRejection', (reason) => {
	console.error('[worker] unhandled rejection:', reason);
});

async function main() {
	if (!ORIGIN) {
		console.error('[worker] PUBLIC_APP_URL (or ORIGIN) is required — it builds the links in notifications');
		process.exit(1);
	}

	console.log(
		`[worker] started — origin=${ORIGIN}, batch=${BATCH}, idlePoll=${IDLE_POLL_MS}ms, text=${textRouteLabel()}`
	);
	let lastReapAt = 0;

	while (!stopping) {
		const reap = Date.now() - lastReapAt > REAP_EVERY_MS;
		draining = true;
		try {
			const { processed, reaped, toolJobs } = await drainChatQueue({
				origin: ORIGIN,
				mode: 'worker',
				maxJobs: BATCH,
				reap
			});
			if (reap) lastReapAt = Date.now();
			if (processed || reaped || toolJobs) {
				console.log(`[worker] lap done — turns=${processed}, toolJobs=${toolJobs}, reaped=${reaped}`);
			}
			draining = false;
			if (stopping) break;
			// Only back off when the lap found nothing at all — either kind of work means more is likely.
			if (!processed && !toolJobs) await sleep(IDLE_POLL_MS);
		} catch (e) {
			draining = false;
			console.error('[worker] drain failed:', e);
			if (stopping) break;
			await sleep(IDLE_POLL_MS);
		}
	}

	console.log('[worker] stopped');
	process.exit(0);
}

void main();
