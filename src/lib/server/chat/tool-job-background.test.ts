/**
 * Il giro completo di un lavoro lungo, come lo vive l'utente.
 *
 * Il bug che questi test bloccano: `runLongTool` eseguiva il tool DENTRO il turno e il turno
 * restava appeso finché non finiva — mentre la UI, che disegna l'indicatore leggendo proprio la
 * riga `chat_jobs` inserita lì, diceva "sto lavorando in background, puoi andartene". Prova reale
 * (22/08, thread di onboarding 99fc02fb): tool job `seo_geo_audit` 355s, e il turno `chat_response`
 * partito 29s prima ancora `running` a 453s.
 *
 * Quindi qui si verifica, nell'ordine: il tool delega e torna subito → il turno può chiudersi →
 * il worker esegue e l'esito RIENTRA come turno accodato → la mailbox dei DM lo assorbe se un
 * turno è ancora vivo → errore e scadenza rientrano anche loro, mai in silenzio.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const executeChatToolJob = vi.fn();
vi.mock('$lib/server/chat/job-executor', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	executeChatToolJob: (...args: unknown[]) => executeChatToolJob(...args)
}));
// Il reaper avvisa Sentry/mail: fuori tema qui, e non deve uscire dalla suite.
vi.mock('$lib/server/chat/report-error', () => ({ reportChatError: vi.fn(async () => {}) }));

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

beforeEach(() => {
	executeChatToolJob.mockReset();
	executeChatToolJob.mockResolvedValue({ tech_score: 62, issues: 4, share_of_voice: 11, gaps: 7 });
});

describe('il tool delega e il turno può chiudersi', () => {
	it('run_seo_geo_audit accoda un job pending e torna SENZA eseguirlo', async () => {
		const kit = createTestSupabase({
			brands: [{ id: 'b1', plan: 'pro', slug: 'acme', name: 'Acme' }],
			chat_jobs: []
		});
		const { createChatTools } = await import('./tools');
		const tools = createChatTools(
			kit.client,
			'b1',
			'Europe/Rome',
			'u1',
			'', // origin vuoto: nessun kick HTTP in test
			'it',
			'thread-1'
		) as Record<string, { execute: (i: unknown, o: unknown) => Promise<Row> }>;

		const out = await tools.run_seo_geo_audit.execute({}, {});

		// 1. non ha eseguito niente dentro il turno
		expect(executeChatToolJob).not.toHaveBeenCalled();
		// 2. ha detto al modello di chiudere, non di aspettare
		expect(out.background).toBe(true);
		expect(out.tech_score).toBeUndefined();
		expect(String(out.message)).toMatch(/END YOUR TURN/);
		expect(String(out.message)).toMatch(/not done|no result/i);
		// 3. la riga è `pending`: nel resto del sistema significa "nessuno la sta eseguendo"
		const rows = kit.tables.get('chat_jobs') ?? [];
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('pending');
		expect(rows[0].tool_name).toBe('seo_geo_audit');
		expect(rows[0].thread_id).toBe('thread-1');
		// 4. lingua e origin viaggiano nei params: chi chiude la riga è un altro processo
		expect(rows[0].input_params.report_locale).toBe('it');
	});

	it('Stop premuto prima della delega non lascia niente in coda', async () => {
		const kit = createTestSupabase({ brands: [{ id: 'b1', plan: 'pro' }], chat_jobs: [] });
		const { createChatTools } = await import('./tools');
		const tools = createChatTools(kit.client, 'b1', 'Europe/Rome', 'u1', '', 'it', 'thread-1') as Record<
			string,
			{ execute: (i: unknown, o: unknown) => Promise<Row> }
		>;
		const ac = new AbortController();
		ac.abort();

		const out = await tools.run_seo_geo_audit.execute({}, { abortSignal: ac.signal });

		expect(out.cancelled).toBe(true);
		expect(kit.tables.get('chat_jobs') ?? []).toHaveLength(0);
	});
});

function pendingJob(over: Row = {}): Row {
	return {
		id: 'job-1',
		brand_id: 'b1',
		user_id: 'u1',
		thread_id: 'thread-1',
		tool_name: 'seo_geo_audit',
		input_params: { report_locale: 'it', report_origin: '' },
		status: 'pending',
		created_at: iso(5_000),
		...over
	};
}

/** La riga di turno che il rientro deve aver accodato sul thread. */
const reportTurns = (kit: ReturnType<typeof createTestSupabase>) =>
	(kit.tables.get('chat_jobs') ?? []).filter((r) => r.tool_name === 'chat_response');

describe("l'esito rientra in conversazione", () => {
	it('successo: il worker chiude la riga e accoda un turno con il risultato', async () => {
		const kit = createTestSupabase({ chat_jobs: [pendingJob()] });
		const { processNextPendingToolJob } = await import('./queue');

		const r = await processNextPendingToolJob(kit.client, '');

		expect(r.processed).toBe(true);
		expect(executeChatToolJob).toHaveBeenCalledTimes(1);
		const job = (kit.tables.get('chat_jobs') ?? []).find((x) => x.id === 'job-1');
		expect(job.status).toBe('done');
		expect(job.result.tech_score).toBe(62);

		const turns = reportTurns(kit);
		expect(turns).toHaveLength(1);
		expect(turns[0].status).toBe('pending');
		expect(turns[0].thread_id).toBe('thread-1');
		// Il testo porta i numeri veri, non "è finito qualcosa".
		expect(turns[0].input_params.user_message).toMatch(/seo_geo_audit/);
		expect(turns[0].input_params.user_message).toMatch(/62/);
	});

	it('errore: rientra lo stesso, onesto, e senza ritentare da solo', async () => {
		executeChatToolJob.mockRejectedValue(new Error('site unreachable'));
		const kit = createTestSupabase({ chat_jobs: [pendingJob()] });
		const { processNextPendingToolJob } = await import('./queue');

		await processNextPendingToolJob(kit.client, '');

		const job = (kit.tables.get('chat_jobs') ?? []).find((x) => x.id === 'job-1');
		expect(job.status).toBe('failed');
		const turns = reportTurns(kit);
		expect(turns).toHaveLength(1);
		expect(turns[0].input_params.user_message).toMatch(/site unreachable/);
		expect(turns[0].input_params.user_message).toMatch(/non ritentare/i);
	});

	it('scadenza: il reaper chiude il job morto e lo racconta comunque', async () => {
		// Pending più vecchio di CHAT_PENDING_STALE_MS (60 min): nessun worker l'ha mai preso.
		const kit = createTestSupabase({ chat_jobs: [pendingJob({ created_at: iso(3 * 60 * 60_000) })] });
		const { reapStaleChatJobs } = await import('./job-cancel');

		const reaped = await reapStaleChatJobs(kit.client, { userId: 'u1' });

		expect(reaped).toBe(1);
		const job = (kit.tables.get('chat_jobs') ?? []).find((x) => x.id === 'job-1');
		expect(job.status).toBe('failed');
		const turns = reportTurns(kit);
		expect(turns).toHaveLength(1);
		expect(turns[0].input_params.user_message).toMatch(/non è riuscito/);
	});

	it('un "no" del tool (quota, piano) rientra con messaggio E azione, non con la sola stringa', async () => {
		executeChatToolJob.mockResolvedValue({
			error: 'posts_quota_exhausted',
			message: 'Monthly post quota reached — explain, call offer_upgrade, do not retry.',
			action: 'offer_upgrade'
		});
		const kit = createTestSupabase({ chat_jobs: [pendingJob({ tool_name: 'produce_week' })] });
		const { processNextPendingToolJob } = await import('./queue');

		await processNextPendingToolJob(kit.client, '');

		const msg = String(reportTurns(kit)[0].input_params.user_message);
		expect(msg).toMatch(/Monthly post quota reached/);
		expect(msg).toMatch(/offer_upgrade/);
	});

	it('un job senza thread (CLI, cron) non inventa una conversazione', async () => {
		const kit = createTestSupabase({ chat_jobs: [pendingJob({ thread_id: null })] });
		const { processNextPendingToolJob } = await import('./queue');

		await processNextPendingToolJob(kit.client, '');

		expect(reportTurns(kit)).toHaveLength(0);
	});
});

describe('è il meccanismo dei DM, non un secondo meccanismo', () => {
	it('se un turno è ancora vivo, la mailbox assorbe il rientro al confine di step', async () => {
		const kit = createTestSupabase({ chat_jobs: [pendingJob()] });
		const { processNextPendingToolJob } = await import('./queue');
		await processNextPendingToolJob(kit.client, '');

		const { claimQueuedFollowUps } = await import('./mid-turn-mailbox');
		const claims = await claimQueuedFollowUps(kit.client, { userId: 'u1', threadId: 'thread-1' });

		expect(claims).toHaveLength(1);
		expect(claims[0].text).toMatch(/seo_geo_audit/);
		// Consumato UNA volta: il turno accodato non gira anche da solo dopo.
		const turn = reportTurns(kit)[0];
		expect(turn.status).toBe('done');
		expect(turn.result.consumed_mid_turn).toBe(true);
	});
});
