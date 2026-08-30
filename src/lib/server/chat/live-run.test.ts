import { describe, expect, it } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { loadLiveRun } from './live-run';

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const run = (over: Record<string, unknown> = {}) => ({
	id: 'run-1',
	thread_id: 'thread-1',
	agent_id: 'content',
	state: 'running',
	created_at: iso(60_000),
	heartbeat_at: iso(2_000),
	partial: { text: 'sto scrivendo' },
	partial_saved_msg_id: null,
	...over
});

describe('loadLiveRun', () => {
	it('restituisce il run al lavoro, così il primo render ha dove disegnare il parziale', async () => {
		const db = createTestSupabase({ agent_kit_runs: [run()] });

		expect(await loadLiveRun(db.client, 'thread-1')).toMatchObject({ id: 'run-1', state: 'running' });
	});

	it('un run col battito fermo non è vivo: niente bolla per un cadavere', async () => {
		const db = createTestSupabase({ agent_kit_runs: [run({ heartbeat_at: iso(30 * 60_000) })] });

		expect(await loadLiveRun(db.client, 'thread-1')).toBeNull();
	});

	it('un run finito non si mostra', async () => {
		const db = createTestSupabase({ agent_kit_runs: [run({ state: 'done' })] });

		expect(await loadLiveRun(db.client, 'thread-1')).toBeNull();
	});

	it('il thread senza run non esplode', async () => {
		const db = createTestSupabase({ agent_kit_runs: [] });

		expect(await loadLiveRun(db.client, 'thread-1')).toBeNull();
	});
});
