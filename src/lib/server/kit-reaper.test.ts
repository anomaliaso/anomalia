/**
 * Il reaper dei run kit: chi decide che un turno è morto, quando, e chi lo viene a sapere.
 *
 * I due difetti pinnati qui (registro di parità, B7 e B11): la soglia piatta di dieci minuti —
 * l'utente restava chiuso fuori dal thread mentre guardava un cadavere — e il silenzio, perché
 * lo sweep chiudeva le righe restituendo un numero nel JSON del cron e nessuno riceveva niente.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';

const reportChatError = vi.fn(async () => {});
vi.mock('$lib/server/chat/report-error', () => ({ reportChatError: (...a: unknown[]) => reportChatError(...(a as [])) }));

const { reapDeadKitRuns } = await import('./agent-kit-recover');

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const run = (over: Record<string, unknown> = {}) => ({
	id: 'run-1',
	brand_id: 'brand-1',
	user_id: 'user-1',
	thread_id: 'thread-1',
	agent_id: 'content',
	state: 'running',
	reason: null,
	partial: null,
	partial_saved_msg_id: null,
	heartbeat_at: iso(2 * 60_000),
	created_at: iso(10 * 60_000),
	...over
});

beforeEach(() => reportChatError.mockClear());

describe('reapDeadKitRuns', () => {
	it('battito fermo da 2 minuti: il run è chiuso adesso, non fra dieci', async () => {
		const kit = createTestSupabase({ agent_kit_runs: [run()], chat_messages: [] });

		expect(await reapDeadKitRuns(kit.client)).toBe(1);
		expect(kit.tables.get('agent_kit_runs')?.[0].state).toBe('aborted');
	});

	it('battito di 30 secondi fa: il turno sta lavorando, non si tocca', async () => {
		const kit = createTestSupabase({
			agent_kit_runs: [run({ heartbeat_at: iso(30_000) })],
			chat_messages: []
		});

		expect(await reapDeadKitRuns(kit.client)).toBe(0);
		expect(kit.tables.get('agent_kit_runs')?.[0].state).toBe('running');
		expect(reportChatError).not.toHaveBeenCalled();
	});

	it('un run morto senza parziale non muore in silenzio: ops lo viene a sapere', async () => {
		const kit = createTestSupabase({ agent_kit_runs: [run()], chat_messages: [] });

		await reapDeadKitRuns(kit.client);

		expect(reportChatError).toHaveBeenCalledTimes(1);
		const ctx = reportChatError.mock.calls[0][2] as Record<string, unknown>;
		expect(ctx).toMatchObject({
			brandId: 'brand-1',
			userId: 'user-1',
			threadId: 'thread-1',
			kind: 'kit_turn_died',
			notify: 'all'
		});
	});

	it('il parziale prodotto prima della morte finisce comunque in chat', async () => {
		const kit = createTestSupabase({
			agent_kit_runs: [run({ partial: { text: 'ho preparato i tre post' } })],
			chat_messages: []
		});

		await reapDeadKitRuns(kit.client);

		const saved = kit.tables.get('chat_messages') ?? [];
		expect(saved).toHaveLength(1);
		expect(String(saved[0].content)).toContain('ho preparato i tre post');
	});

	it('oltre il tetto delle mail si avvisa lo stesso, ma solo Sentry', async () => {
		const rows = [1, 2, 3].map((n) => run({ id: `run-${n}`, thread_id: `thread-${n}` }));
		const kit = createTestSupabase({ agent_kit_runs: rows, chat_messages: [] });

		expect(await reapDeadKitRuns(kit.client, { emailBudget: 1 })).toBe(3);
		const notify = reportChatError.mock.calls.map((c) => (c[2] as { notify?: string }).notify);
		expect(notify).toEqual(['all', 'sentry', 'sentry']);
	});
});
