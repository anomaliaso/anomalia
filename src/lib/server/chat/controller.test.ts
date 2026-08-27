import { describe, expect, it, vi, beforeEach } from 'vitest';

const genMock = vi.fn();
vi.mock('ai', async (orig) => ({
	...((await orig()) as object),
	generateText: (...a: unknown[]) => genMock(...a)
}));

const envHolder: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: envHolder }));

const modelHolder: { current: unknown } = {
	current: { model: {}, modelId: 'gpt-5-6-luna', provider: 'kie', callOptions: {} }
};
vi.mock('$lib/server/chat/model', () => ({ compactionModel: () => modelHolder.current }));

const logged: Array<Record<string, unknown>> = [];
vi.mock('$lib/server/ai-log', () => ({
	logAiCall: (row: Record<string, unknown>) => {
		logged.push(row);
	}
}));

const { createHarnessSession } = await import('$lib/server/harness/session');
const { controllerPipeline, observeIrreversibleAction, judgeTurnShadow, CONTROLLER_LEVER } =
	await import('./controller');

function answers(...pairs: Array<[string, boolean]>) {
	return {
		text: JSON.stringify(pairs.map(([question, answer]) => ({ question, answer, reason: 'r' }))),
		usage: { inputTokens: 2500, outputTokens: 150 }
	};
}

function chatSession() {
	const s = createHarnessSession({
		agent: 'chat',
		surface: 'chat',
		brandId: 'b1',
		userId: 'u1',
		threadId: 't1'
	});
	s.captureRequest({ system: 'sys', messages: [{ role: 'user', content: 'approva il post di lunedì' }] });
	return s;
}

beforeEach(() => {
	genMock.mockReset();
	logged.length = 0;
	envHolder.CHAT_CONTROLLER = 'shadow';
	modelHolder.current = { model: {}, modelId: 'gpt-5-6-luna', provider: 'kie', callOptions: {} };
});

describe('il controllore in ombra', () => {
	it('non blocca mai: davanti a un tool irreversibile la pipeline lascia passare', async () => {
		genMock.mockResolvedValue(answers(['dangerous', true], ['needs_consent', true]));
		const session = chatSession();
		const hook = controllerPipeline(session)!.before![0]!;
		const gate = await hook({ name: 'approve_post', input: { id: 'p1' } });
		expect(gate).toBeUndefined();
	});

	it('il verdetto arriva sulla prima azione irreversibile, e dice quale leva AVREBBE tirato', async () => {
		genMock.mockResolvedValue(answers(['dangerous', false], ['needs_consent', true]));
		const session = chatSession();
		const rec = await observeIrreversibleAction(session, 'approve_post');
		expect(rec?.verdict).toBe('needs_consent');
		expect(rec?.lever).toBe('ask');
		expect(CONTROLLER_LEVER.needs_consent).toBe('ask');
		expect(rec?.enforced).toBe(false);
	});

	it('registra il giudizio dove si legge dopo: evento di sessione e riga di costo', async () => {
		genMock.mockResolvedValue(answers(['dangerous', true], ['needs_consent', false]));
		const session = chatSession();
		await observeIrreversibleAction(session, 'reject_post');

		const ev = session.events.find((e) => e.type === 'steward');
		expect(ev && ev.type === 'steward' && ev.notes[0]!.code).toBe('controller.dangerous');
		expect(ev && ev.type === 'steward' && ev.notes[0]!.text).toContain('deny');
		expect(ev && ev.type === 'steward' && ev.notes[0]!.text).toContain('reject_post');

		expect(logged).toHaveLength(1);
		expect(logged[0]!.label).toBe('chatController');
		expect(logged[0]!.inputTokens).toBe(2500);
		expect(String(logged[0]!.context)).toContain('dangerous');
		expect(String(logged[0]!.context)).toContain('deny');
		expect(logged[0]!.brandId).toBe('b1');
	});

	it('un giudizio per turno, non uno per chiamata', async () => {
		genMock.mockResolvedValue(answers(['dangerous', false], ['needs_consent', false]));
		const session = chatSession();
		await observeIrreversibleAction(session, 'approve_post');
		await observeIrreversibleAction(session, 'approve_post');
		await observeIrreversibleAction(session, 'cross_post');
		expect(genMock).toHaveBeenCalledTimes(1);
	});

	it('un tool reversibile non paga niente', async () => {
		const session = chatSession();
		expect(await observeIrreversibleAction(session, 'read_brand_studio')).toBeNull();
		expect(genMock).not.toHaveBeenCalled();
	});

	it('spento di default: nessuna pipeline, nessuna chiamata', async () => {
		delete envHolder.CHAT_CONTROLLER;
		const session = chatSession();
		expect(controllerPipeline(session)).toBeUndefined();
		expect(await observeIrreversibleAction(session, 'approve_post')).toBeNull();
		expect(genMock).not.toHaveBeenCalled();
	});

	it('fuori dalla chat non guarda niente', async () => {
		const batch = createHarnessSession({ agent: 'produce', surface: 'batch', brandId: 'b1' });
		expect(controllerPipeline(batch)).toBeUndefined();
	});

	it('fail-open: giudice rotto → nessun verdetto, ma la riga di costo resta', async () => {
		genMock.mockRejectedValue(new Error('model down'));
		const session = chatSession();
		expect(await observeIrreversibleAction(session, 'approve_post')).toBeNull();
		expect(logged).toHaveLength(1);
		expect(logged[0]!.ok).toBe(false);
	});
});

describe('il controllore a fine turno', () => {
	const facts = (over: Record<string, unknown> = {}) => ({
		brandId: 'b1',
		userId: 'u1',
		threadId: 't1',
		userAsk: 'renderizza il video',
		replyText: 'Correggo e poi renderizzo.',
		succeededTools: ['motion_write'],
		...over
	});

	it('senza promessa non chiama il giudice', async () => {
		const rec = await judgeTurnShadow(facts({ replyText: 'Video renderizzato: url.mp4' }));
		expect(rec).toBeNull();
		expect(genMock).not.toHaveBeenCalled();
	});

	it('promessa + giudice concorde → incomplete, leva continue, registrato', async () => {
		genMock.mockResolvedValue(answers(['off_ask', false], ['incomplete', true], ['rethink', false]));
		const rec = await judgeTurnShadow(facts());
		expect(rec?.verdict).toBe('incomplete');
		expect(rec?.lever).toBe('continue');
		expect(rec?.enforced).toBe(false);
		expect(String(logged[0]!.context)).toContain('turn');
		expect(String(logged[0]!.context)).toContain('incomplete');
	});

	it('giudice concorde su niente → nessun verdetto', async () => {
		genMock.mockResolvedValue(answers(['off_ask', false], ['incomplete', false], ['rethink', false]));
		expect(await judgeTurnShadow(facts())).toBeNull();
	});
});
