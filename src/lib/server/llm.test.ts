import { LLM_TIMEOUT_MS, LLM_REASONING_EFFORT } from './llm';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const M = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	catalogDefault: null as string | null
}));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/chat-model-catalog', () => ({ defaultChatModelId: () => M.catalogDefault }));

function setEnv(vars: Record<string, string | undefined>) {
	for (const k of Object.keys(M.env)) delete M.env[k];
	Object.assign(M.env, vars);
}

describe('llm — catalogo e fallback', () => {
	beforeEach(() => {
		vi.resetModules();
		setEnv({});
		M.catalogDefault = null;
	});

	/**
	 * IL DIFETTO PAGATO, 2026-09-02. La riga marcata in Supabase diceva `z-ai/glm-5.3-flash`,
	 * l'env diceva `google/gemini-3.8-flash`, e il turno e` girato sull'env — senza un errore da
	 * nessuna parte. Il piu` silenzioso che ci sia: il turno riesce, solo sul modello sbagliato.
	 * Se questo test cade, l'operatore cambia la riga in Studio e non succede niente.
	 */
	it('il default del catalogo batte LLM_DEFAULT_MODEL', async () => {
		setEnv({ LLM_API_KEY: 'k', LLM_DEFAULT_MODEL: 'google/gemini-3.8-flash' });
		M.catalogDefault = 'z-ai/glm-5.3-flash';
		const { llmModelForPicker } = await import('./llm');
		expect(llmModelForPicker(null)).toBe('z-ai/glm-5.3-flash');
		expect(llmModelForPicker(undefined)).toBe('z-ai/glm-5.3-flash');
	});

	/** A catalogo vuoto o irraggiungibile resta l'env: un'istanza appena installata parte lo stesso. */
	it('senza riga marcata decide l\'env', async () => {
		setEnv({ LLM_API_KEY: 'k', LLM_DEFAULT_MODEL: 'google/gemini-3.8-flash' });
		const { llmModelForPicker } = await import('./llm');
		expect(llmModelForPicker(null)).toBe('google/gemini-3.8-flash');
	});

	it('senza LLM_DEFAULT_MODEL il default non esiste', async () => {
		setEnv({ LLM_API_KEY: 'k' });
		const { llmDefaultModel, LLM_UNCONFIGURED } = await import('./llm');
		expect(() => llmDefaultModel()).toThrow(LLM_UNCONFIGURED);
	});

	it('il reviewer cade sul default solo se è google/gemini-*', async () => {
		setEnv({ LLM_API_KEY: 'k', LLM_DEFAULT_MODEL: 'google/gemini-2.5-flash' });
		const { llmVideoReviewerModel } = await import('./llm');
		expect(llmVideoReviewerModel()).toBe('google/gemini-2.5-flash');
	});

	it('il reviewer NON cade su un default non-Gemini', async () => {
		setEnv({ LLM_API_KEY: 'k', LLM_DEFAULT_MODEL: 'anthropic/claude-sonnet-4' });
		const { llmVideoReviewerModel, LLM_VIDEO_UNCONFIGURED } = await import('./llm');
		expect(() => llmVideoReviewerModel()).toThrow(LLM_VIDEO_UNCONFIGURED);
	});

	it('LLM_VIDEO_REVIEWER_MODEL vince, senza alias', async () => {
		setEnv({
			LLM_API_KEY: 'k',
			LLM_DEFAULT_MODEL: 'google/gemini-2.5-flash',
			LLM_VIDEO_REVIEWER_MODEL: 'google/gemini-2.5-pro'
		});
		const { llmVideoReviewerModel } = await import('./llm');
		expect(llmVideoReviewerModel()).toBe('google/gemini-2.5-pro');
	});

	it('gli embeddings non cadono sulla chat', async () => {
		setEnv({ LLM_API_KEY: 'k', LLM_DEFAULT_MODEL: 'google/gemini-2.5-flash' });
		const { llmEmbeddingModel, LLM_EMBEDDING_UNCONFIGURED } = await import('./llm');
		expect(() => llmEmbeddingModel()).toThrow(LLM_EMBEDDING_UNCONFIGURED);
	});

	it('il picker usa LLM_MODELS, e senza scelta il default', async () => {
		setEnv({
			LLM_API_KEY: 'k',
			LLM_DEFAULT_MODEL: 'google/gemini-2.5-flash',
			LLM_MODELS: 'google/gemini-2.5-flash,anthropic/claude-sonnet-4'
		});
		const { llmModels, llmModelForPicker } = await import('./llm');
		expect(llmModels()).toEqual(['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4']);
		expect(llmModelForPicker(null)).toBe('google/gemini-2.5-flash');
		expect(llmModelForPicker('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
		// I preset spariti non salgono piu` al secondo id: non sono una scelta.
		expect(llmModelForPicker('pro')).toBe('google/gemini-2.5-flash');
		expect(llmModelForPicker('fast')).toBe('google/gemini-2.5-flash');
	});

	/**
	 * Il picker offre il catalogo del gateway, non solo i due id di LLM_MODELS: un modello scelto
	 * dall'utente deve arrivare INTATTO al gateway. Prima cadeva sul default in silenzio — cioè
	 * "GPT Terra" nel menu e DeepSeek nella risposta.
	 */
	it('un id del catalogo passa intatto, anche fuori da LLM_MODELS', async () => {
		setEnv({
			LLM_API_KEY: 'k',
			LLM_DEFAULT_MODEL: 'google/gemini-2.5-flash',
			LLM_MODELS: 'google/gemini-2.5-flash'
		});
		const { llmModelForPicker } = await import('./llm');
		const { __resetGatewayModels, ensureGatewayModels } = await import('./openrouter-models');
		__resetGatewayModels();
		await ensureGatewayModels({
			baseUrl: 'https://openrouter.ai/api/v1',
			fetchImpl: (async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					data: [
						{
							id: 'anthropic/claude-opus-5',
							name: 'Claude Opus 5',
							context_length: 1000,
							supported_parameters: ['tools'],
							architecture: { input_modalities: ['text', 'image'] },
							pricing: { prompt: '0.000001', completion: '0.000002' }
						}
					]
				})
			})) as unknown as typeof fetch
		});
		expect(llmModelForPicker('anthropic/claude-opus-5')).toBe('anthropic/claude-opus-5');
		// Un id che il gateway non serve non diventa una chiamata persa: si torna al default.
		expect(llmModelForPicker('vendor/mai-visto')).toBe('google/gemini-2.5-flash');
		__resetGatewayModels();
	});

	it('GEO Gemini search vuole un id google/gemini-*', async () => {
		setEnv({ LLM_API_KEY: 'k', LLM_DEFAULT_MODEL: 'anthropic/claude-sonnet-4' });
		const { llmGeminiSearchModel } = await import('./llm');
		expect(() => llmGeminiSearchModel()).toThrow(/google\/gemini-/);
		setEnv({
			LLM_API_KEY: 'k',
			LLM_DEFAULT_MODEL: 'anthropic/claude-sonnet-4',
			LLM_MODELS: 'anthropic/claude-sonnet-4,google/gemini-2.5-flash'
		});
		expect(llmGeminiSearchModel()).toBe('google/gemini-2.5-flash');
	});

	it('Lyria clip vs pro sono due id, non una env', async () => {
		const { lyriaModel, LYRIA_CLIP, LYRIA_PRO } = await import('./llm');
		expect(lyriaModel('clip')).toBe(LYRIA_CLIP);
		expect(lyriaModel('pro')).toBe(LYRIA_PRO);
	});

	it('musicBytesFromChatCompletion legge audio base64 MP3', async () => {
		const { musicBytesFromChatCompletion } = await import('./llm');
		const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
		const bytes = musicBytesFromChatCompletion({
			choices: [{ message: { audio: { data: mp3.toString('base64') } } }]
		});
		expect(bytes[0]).toBe(0xff);
	});
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../..');

function walkTs(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walkTs(p, acc);
		else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) acc.push(p);
	}
	return acc;
}

describe('nessun SDK Google nei call site app', () => {
	it('createGoogleGenerativeAI / googleGenaiClient solo in gemini.ts (morto) o test', () => {
		const allowed = new Set([
			join(HERE, 'gemini.ts'),
			join(HERE, 'content-preview/images.ts'), // pixel: Kie, con ripiego Google solo lì
			join(HERE, 'blog-month.ts') // batch API immagini Google: kie non ce l'ha
		]);
		const hits: string[] = [];
		for (const file of walkTs(join(SRC, 'lib'))) {
			if (allowed.has(file)) continue;
			if (file.includes('.test.')) continue;
			const src = readFileSync(file, 'utf8');
			if (src.includes('createGoogleGenerativeAI') || src.includes('googleGenaiClient(')) {
				hits.push(file.replace(SRC + '/', ''));
			}
		}
		for (const file of walkTs(join(SRC, 'routes'))) {
			if (file.includes('.test.')) continue;
			const src = readFileSync(file, 'utf8');
			if (src.includes('createGoogleGenerativeAI') || src.includes('googleGenaiClient(')) {
				hits.push(file.replace(SRC + '/', ''));
			}
		}
		expect(hits, hits.join('\n')).toEqual([]);
	});
});

// Una chiamata al gateway non scadeva mai, e la pagina che l'aspettava nemmeno. La scadenza però
// deve stare LARGA: misurato sul percorso vero, il modello di default impiega 107s dove gemini ne
// impiega 15 — su uno schema piccolo. Una scadenza stretta trasformerebbe la lentezza in un guasto,
// che è esattamente la diagnosi sbagliata da cui questo commento nasce.
describe('LLM_TIMEOUT_MS', () => {
  it('lascia spazio a un modello lento invece di scambiarlo per rotto', () => {
    expect(LLM_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
  });
});

// Il campo `reasoning` non veniva mandato mai, e il default non impostato è patologico: misurato su
// z-ai/glm-5.3-flash, 113s e 12.134 token per un risultato SBAGLIATO (1 elemento su 3 chiesti).
// Con un effort qualunque — anche 'high' — sono 7s e il risultato giusto.
describe('LLM_REASONING_EFFORT', () => {
  it('è sempre uno sforzo dichiarato, mai il default del provider', () => {
    expect(['low', 'medium', 'high']).toContain(LLM_REASONING_EFFORT);
  });
});
