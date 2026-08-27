import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CHAT_HEARTBEAT_STALE_MS,
	chatJobDeathKind,
	chatJobDeathMessage,
	CHAT_MAX_DURATION_MS,
	CHAT_PENDING_STALE_MS,
	CHAT_RUNNING_HARD_STALE_MS,
	CHAT_TURN_ABORT_MS,
	CHAT_TURN_BUDGET_MS,
	chatMaxTurns,
	chatSubAgentMaxTurns,
	chatTurnDeadline,
	classifyChatJob
} from './turn-limits';
import { CHAT_JOB_STALE_MS } from './job-cancel';

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('budgets', () => {
	it('leaves room for onFinish and for the abort to persist inside the wall', () => {
		expect(CHAT_TURN_BUDGET_MS).toBeLessThan(CHAT_TURN_ABORT_MS);
		expect(CHAT_TURN_ABORT_MS).toBeLessThan(CHAT_MAX_DURATION_MS);
	});

	// Vercel only honours its own tiers; an in-between number is silently not what you asked for.
	// 300 = every plan, 800 = Pro/Enterprise GA, 1800 = Pro/Enterprise extended (per-function).
	// This must equal `export const config = { maxDuration }` on the chat routes.
	it('sits on a duration Vercel actually offers', () => {
		expect([300_000, 800_000, 1_800_000]).toContain(CHAT_MAX_DURATION_MS);
	});

	// The reserves are absolute costs (persist, log, extract memory, kick) — they must not be
	// squeezed out when the wall changes, and they must stay big enough to finish that work.
	it('keeps both reserves inside a sane band whatever the wall is', () => {
		const postModel = CHAT_MAX_DURATION_MS - CHAT_TURN_BUDGET_MS;
		const salvage = CHAT_MAX_DURATION_MS - CHAT_TURN_ABORT_MS;
		expect(salvage).toBeGreaterThanOrEqual(30_000);
		expect(postModel).toBeGreaterThan(salvage);
		expect(postModel).toBeLessThan(CHAT_MAX_DURATION_MS / 2);
	});

	// A live turn must never drop out of the "is a reply in flight?" queries: if this filter is
	// shorter than a turn may run, a client reloading late finds no job and never starts polling.
	it('believes a running job for at least as long as a turn may take', () => {
		expect(CHAT_JOB_STALE_MS).toBeGreaterThan(CHAT_MAX_DURATION_MS);
	});
});

describe('chatTurnDeadline', () => {
	it('does not fire inside the budget and latches once past it', () => {
		const d = chatTurnDeadline(Date.now(), 50_000);
		expect(d.reached()).toBe(false);
		expect(d.expired).toBe(false);

		const past = chatTurnDeadline(Date.now() - 60_000, 50_000);
		expect(past.reached()).toBe(true);
		expect(past.expired).toBe(true);
		expect(past.remainingMs()).toBe(0);
	});
});

describe('classifyChatJob', () => {
	it('trusts a running turn whose heartbeat is fresh, however old the row is', () => {
		// The bug this replaces: judged by created_at alone this 4-minute turn was "alive" and a
		// 6-minute dead one was too. Only the heartbeat separates them.
		const job = { status: 'running', created_at: ago(4 * 60_000), partial: { at: NOW - 5_000 } };
		expect(classifyChatJob(job, NOW).dead).toBe(false);
	});

	it('declares a running turn dead once the heartbeat goes silent', () => {
		const job = {
			status: 'running',
			created_at: ago(3 * 60_000),
			partial: { at: NOW - CHAT_HEARTBEAT_STALE_MS - 1_000 }
		};
		expect(classifyChatJob(job, NOW)).toEqual({ dead: true, reason: 'heartbeat' });
	});

	it('falls back to the function wall when no heartbeat was ever written', () => {
		// Anchored to the wall, not to a wall-clock guess: the whole point of this branch is that
		// it moves when maxDuration moves, and a hardcoded age quietly stops testing that.
		expect(
			classifyChatJob({ status: 'running', created_at: ago(CHAT_RUNNING_HARD_STALE_MS - 60_000) }, NOW).dead
		).toBe(false);
		expect(
			classifyChatJob({ status: 'running', created_at: ago(CHAT_RUNNING_HARD_STALE_MS + 60_000) }, NOW)
		).toEqual({ dead: true, reason: 'wall' });
	});

	it('lets queued turns wait minutes without being murdered', () => {
		// A pending job is behind another turn — old is normal, and the old single threshold
		// would have closed it while the user was still waiting for their answer.
		expect(classifyChatJob({ status: 'pending', created_at: ago(10 * 60_000) }, NOW).dead).toBe(false);
		expect(
			classifyChatJob({ status: 'pending', created_at: ago(CHAT_PENDING_STALE_MS + 60_000) }, NOW)
		).toEqual({ dead: true, reason: 'orphaned_queue' });
	});

	it('never touches a job that already reached a terminal state', () => {
		for (const status of ['done', 'failed', 'cancelled']) {
			expect(classifyChatJob({ status, created_at: ago(60 * 60_000) }, NOW).dead).toBe(false);
		}
	});

	it('ignores a garbage heartbeat instead of trusting it', () => {
		const job = {
			status: 'running',
			created_at: ago(CHAT_RUNNING_HARD_STALE_MS + 60_000),
			partial: { at: 'soon' }
		};
		expect(classifyChatJob(job, NOW)).toEqual({ dead: true, reason: 'wall' });
	});
});

describe('death labelling', () => {
	it('names the tool so a dead tool job is not read as a chat bug', () => {
		// A stale `reanalyze_brand` row reported as "queued chat turn" sends you to the wrong
		// subsystem — this happened for real on three July rows.
		expect(chatJobDeathMessage('orphaned_queue', 'reanalyze_brand')).toContain('reanalyze_brand');
		expect(chatJobDeathKind('orphaned_queue', 'reanalyze_brand')).toBe('chat_tool_job_died');
	});

	it('keeps the conversation wording for the turn itself', () => {
		expect(chatJobDeathMessage('heartbeat', 'chat_response')).toContain('chat turn');
		expect(chatJobDeathMessage('wall', null)).toContain('chat turn');
		expect(chatJobDeathKind('orphaned_queue', 'chat_response')).toBe('chat_queue_orphan');
		expect(chatJobDeathKind('heartbeat', 'chat_response')).toBe('chat_turn_died');
	});
});

describe('chatMaxTurns', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('stays at 75 when the variable is not set', () => {
		vi.stubEnv('CHAT_MAX_TURNS', undefined);
		expect(chatMaxTurns()).toBe(75);
	});

	it('follows the variable when it carries a real number', () => {
		vi.stubEnv('CHAT_MAX_TURNS', '40');
		expect(chatMaxTurns()).toBe(40);
	});

	it('treats a value under the floor as a bug, not as configuration', () => {
		for (const under of ['2', '0', '-5']) {
			vi.stubEnv('CHAT_MAX_TURNS', under);
			expect(chatMaxTurns()).toBe(75);
		}
	});

	it('falls back on garbage instead of poisoning the turn', () => {
		for (const garbage of ['abc', '', '  ']) {
			vi.stubEnv('CHAT_MAX_TURNS', garbage);
			expect(chatMaxTurns()).toBe(75);
		}
	});

	it('accepts any finite value at or above the floor, however large', () => {
		vi.stubEnv('CHAT_MAX_TURNS', '1e9');
		expect(chatMaxTurns()).toBe(1_000_000_000);
	});
});

describe('chatSubAgentMaxTurns', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('keeps the per-role table untouched without the variable', () => {
		vi.stubEnv('CHAT_SUB_AGENT_MAX_TURNS', undefined);
		expect(chatSubAgentMaxTurns('research')).toBe(14);
		expect(chatSubAgentMaxTurns('execute')).toBe(22);
		expect(chatSubAgentMaxTurns('verify')).toBe(10);
		expect(chatSubAgentMaxTurns('sandbox')).toBe(24);
		expect(chatSubAgentMaxTurns('compose')).toBe(12);
	});

	it('clamps an explicit request into [3, 30] without the variable', () => {
		vi.stubEnv('CHAT_SUB_AGENT_MAX_TURNS', undefined);
		expect(chatSubAgentMaxTurns('research', 999)).toBe(30);
		expect(chatSubAgentMaxTurns('research', 1)).toBe(3);
		expect(chatSubAgentMaxTurns('verify', 8)).toBe(8);
	});

	it('makes the variable both the default for every role and the ceiling: steps = clamp(requested ?? env, 3, env)', () => {
		vi.stubEnv('CHAT_SUB_AGENT_MAX_TURNS', '10');
		expect(chatSubAgentMaxTurns('research')).toBe(10);
		expect(chatSubAgentMaxTurns('sandbox')).toBe(10);
		expect(chatSubAgentMaxTurns('execute', 22)).toBe(10);
		expect(chatSubAgentMaxTurns('compose', 6)).toBe(6);
	});

	it('lets the variable raise above the table as well', () => {
		vi.stubEnv('CHAT_SUB_AGENT_MAX_TURNS', '50');
		expect(chatSubAgentMaxTurns('execute')).toBe(50);
		expect(chatSubAgentMaxTurns('execute', 20)).toBe(20);
	});

	it('drives every role down to the floor when the variable sits there', () => {
		vi.stubEnv('CHAT_SUB_AGENT_MAX_TURNS', '3');
		expect(chatSubAgentMaxTurns('sandbox', 24)).toBe(3);
	});

	it('ignores a broken variable and keeps the table behaviour', () => {
		for (const broken of ['abc', '0', '-5']) {
			vi.stubEnv('CHAT_SUB_AGENT_MAX_TURNS', broken);
			expect(chatSubAgentMaxTurns('execute')).toBe(22);
			expect(chatSubAgentMaxTurns('execute', 999)).toBe(30);
		}
	});
});

describe('i tetti che distinguono «lento» da «non partira` mai»', () => {
	it('partire e` piu` stretto che lavorare: aprire una sessione non e` inferenza', async () => {
		const { HARNESS_START_TIMEOUT_MS, HARNESS_SILENCE_TIMEOUT_MS } = await import('./turn-limits');
		expect(HARNESS_START_TIMEOUT_MS).toBeLessThan(HARNESS_SILENCE_TIMEOUT_MS);
	});

	it('il silenzio tollerato supera abbondantemente un battito: non e` un rilevatore di lentezza', async () => {
		const { HARNESS_SILENCE_TIMEOUT_MS, CHAT_HEARTBEAT_INTERVAL_MS } = await import('./turn-limits');
		expect(HARNESS_SILENCE_TIMEOUT_MS).toBeGreaterThan(CHAT_HEARTBEAT_INTERVAL_MS * 5);
	});

	it('entrambi stanno sotto il muro del turno, o non servirebbero a niente', async () => {
		const { HARNESS_START_TIMEOUT_MS, HARNESS_SILENCE_TIMEOUT_MS, CHAT_TURN_ABORT_MS } = await import('./turn-limits');
		expect(HARNESS_START_TIMEOUT_MS).toBeLessThan(CHAT_TURN_ABORT_MS);
		expect(HARNESS_SILENCE_TIMEOUT_MS).toBeLessThan(CHAT_TURN_ABORT_MS);
	});
});
