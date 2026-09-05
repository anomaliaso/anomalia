import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Lo sforzo di ragionamento che un chiamante CHIEDE deve finire sul filo.
 *
 * `LLM_REASONING_EFFORT` copre il default globale, e c'e` gia` un test suo. Qui si guarda l'altro
 * verso: un giudice che chiede 'low' per la sua chiamata deve ottenere 'low', non il default. E`
 * lo stesso guasto dei `plugins` scartati in silenzio — un campo che non arriva non fallisce,
 * risponde bene e misura un'altra cosa.
 */
const M = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	generateObject: vi.fn(async () => ({ object: { ok: true }, usage: {} })),
	generateText: vi.fn(async () => ({ text: 'ciao', usage: {} }))
}));

vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/chat-model-catalog', () => ({ defaultChatModelId: () => null }));
vi.mock('$lib/server/ai-log', () => ({
	logAiCall: vi.fn(),
	extractSdkUsage: () => ({}),
	noteLlmCost: vi.fn()
}));
vi.mock('ai', async () => ({
	...(await vi.importActual<typeof import('ai')>('ai')),
	generateObject: M.generateObject,
	generateText: M.generateText
}));

const SCHEMA = { type: 'object' as const, properties: { ok: { type: 'boolean' as const } } };

describe('lo sforzo di ragionamento chiesto dal call site', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		for (const k of Object.keys(M.env)) delete M.env[k];
		Object.assign(M.env, { LLM_API_KEY: 'k', LLM_DEFAULT_MODEL: 'google/gemini-3.7-flash' });
	});

	it('llmStructured manda l\'effort del chiamante, non il default globale', async () => {
		const { llmStructured } = await import('./llm');
		await llmStructured({ prompt: 'p', schema: SCHEMA, reasoningEffort: 'low' });
		expect(M.generateObject.mock.calls[0][0]).toMatchObject({
			providerOptions: { openai: { reasoning: { effort: 'low' } } }
		});
	});

	it('senza richiesta resta il default dichiarato', async () => {
		M.env.LLM_REASONING_EFFORT = 'medium';
		const { llmStructured } = await import('./llm');
		await llmStructured({ prompt: 'p', schema: SCHEMA });
		expect(M.generateObject.mock.calls[0][0]).toMatchObject({
			providerOptions: { openai: { reasoning: { effort: 'medium' } } }
		});
	});

	it('llmText onora la stessa richiesta', async () => {
		const { llmText } = await import('./llm');
		await llmText({ prompt: 'p', reasoningEffort: 'low' });
		expect(M.generateText.mock.calls[0][0]).toMatchObject({
			providerOptions: { openai: { reasoning: { effort: 'low' } } }
		});
	});
});
