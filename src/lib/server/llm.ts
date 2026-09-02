/**
 * Un trasporto OpenAI-compatibile (in produzione: OpenRouter) e un id modello per mestiere.
 *
 * Non è un secondo SDK Google, non è DeepSeek/Xiaomi/Kie per il testo: è IL tubo. Foto, video e
 * voce restano su Kie; i motori di ricerca restano i loro.
 */
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany, generateObject, generateText, jsonSchema } from 'ai';
import { env } from '$env/dynamic/private';
import { extractSdkUsage, logAiCall, noteLlmCost } from '$lib/server/ai-log';
import { costFromJson, costFromStreamText, withUsageAccounting } from '$lib/server/llm-usage-cost';

export const LLM_UNCONFIGURED = 'llm_unconfigured';
export const LLM_VIDEO_UNCONFIGURED = 'llm_video_unconfigured';
export const LLM_EMBEDDING_UNCONFIGURED = 'llm_embedding_unconfigured';

export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
export const EMBEDDING_DIMENSIONS = 768;

const GEMINI_ID = /^google\/gemini-/;

export function isGoogleGeminiModel(id: string | undefined): boolean {
	return !!id && GEMINI_ID.test(id.trim());
}

export function llmBaseUrl(): string {
	return (env.LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL).replace(/\/$/, '');
}

export function llmApiKey(): string | undefined {
	const key = env.LLM_API_KEY?.trim();
	return key || undefined;
}

export function llmConfigured(): boolean {
	return !!llmApiKey();
}

export function llmDefaultModel(): string {
	const id = env.LLM_DEFAULT_MODEL?.trim();
	if (!id) throw new Error(LLM_UNCONFIGURED);
	return id;
}

/**
 * QC video/audio — non genera clip. Se la var è vuota, si usa il default SOLO se è un Gemini
 * sul gateway; altrimenti il giudice si ferma (embeddings e chat non cadono l’uno sull’altro).
 */
export function llmVideoReviewerModel(): string {
	const explicit = env.LLM_VIDEO_REVIEWER_MODEL?.trim();
	if (explicit) return explicit;
	const fallback = env.LLM_DEFAULT_MODEL?.trim();
	if (fallback && isGoogleGeminiModel(fallback)) return fallback;
	throw new Error(LLM_VIDEO_UNCONFIGURED);
}

export function llmEmbeddingModel(): string {
	const id = env.EMBEDDING_MODEL?.trim();
	if (!id) throw new Error(LLM_EMBEDDING_UNCONFIGURED);
	return id;
}

/** Picker: una fonte sola, lato server. Vuoto → il default, se c’è. */
export function llmModels(): string[] {
	const raw = env.LLM_MODELS?.trim();
	const listed = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
	if (listed.length) return listed;
	const def = env.LLM_DEFAULT_MODEL?.trim();
	return def ? [def] : [];
}

/** Fast/auto = primo della lista (o default). Pro = secondo se c’è. Un id OpenRouter passa così. */
export function llmModelForPicker(choice: string | null | undefined): string {
	const models = llmModels();
	const id = typeof choice === 'string' ? choice.trim() : '';
	if (id && models.includes(id)) return id;
	if ((id === 'pro' || id === 'deepseek-pro' || id === 'gpt-sol') && models[1]) return models[1];
	return llmDefaultModel();
}

let cached: ReturnType<typeof createOpenAI> | null = null;
let cachedSig = '';

/**
 * Chiede il conto al gateway e lo mette nella cassetta dello scope, senza rallentare la risposta.
 *
 * `res.clone()` e non `res.text()`: l'originale continua a scorrere verso l'utente alla sua
 * velocità mentre la copia viene letta a parte. Su un turno in streaming il costo arriva
 * nell'ultimo chunk, quindi si conosce quando l'utente ha già finito di leggere — che è esattamente
 * quando `logAiCall` scrive la riga.
 */
const billedFetch: typeof fetch = async (input, init) => {
	const patched = typeof init?.body === 'string' ? withUsageAccounting(init.body, llmBaseUrl()) : null;
	const res = await fetch(input, patched ? { ...init, body: patched } : init);
	if (!patched) return res;
	const copy = res.clone();
	void (async () => {
		try {
			const text = await copy.text();
			const cost = text.trimStart().startsWith('{') ? costFromJson(JSON.parse(text)) : costFromStreamText(text);
			if (cost != null) noteLlmCost(cost);
		} catch {
			// Nessun costo lasciato dal gateway: decidono le RATES, come prima di questa cassetta.
		}
	})();
	return res;
};

export function llmClient(): ReturnType<typeof createOpenAI> {
	const key = llmApiKey();
	if (!key) throw new Error('LLM_API_KEY is not configured');
	const sig = `${llmBaseUrl()}|${key}`;
	if (cached && cachedSig === sig) return cached;
	cached = createOpenAI({
		baseURL: llmBaseUrl(),
		apiKey: key,
		name: 'llm',
		fetch: billedFetch
	});
	cachedSig = sig;
	return cached;
}

export function llmLanguageModel(modelId?: string) {
	return llmClient()(modelId ?? llmDefaultModel());
}

export type LlmMediaPart = { mediaType: string; data: string };

/** Parti inline Google → parti del centralino. */
export function llmImagesFromInline(
	images?: Array<{ inlineData: { mimeType: string; data: string } }>
): LlmMediaPart[] | undefined {
	if (!images?.length) return undefined;
	return images.map((p) => ({ mediaType: p.inlineData.mimeType, data: p.inlineData.data }));
}

/** Id Gemini sul gateway, per la ricerca nativa OpenRouter (audit GEO). */
export function llmGeminiSearchModel(): string {
	for (const id of llmModels()) {
		if (isGoogleGeminiModel(id)) return id;
	}
	const def = env.LLM_DEFAULT_MODEL?.trim();
	if (def && isGoogleGeminiModel(def)) return def;
	throw new Error('GEO Gemini search needs a google/gemini-* id in LLM_MODELS or LLM_DEFAULT_MODEL');
}

function userContent(
	prompt: string,
	images?: LlmMediaPart[],
	file?: LlmMediaPart
): Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer; mediaType: string } | { type: 'file'; data: Buffer; mediaType: string }> {
	const parts: Array<
		{ type: 'text'; text: string } | { type: 'image'; image: Buffer; mediaType: string } | { type: 'file'; data: Buffer; mediaType: string }
	> = [{ type: 'text', text: prompt }];
	for (const img of images ?? []) {
		parts.push({ type: 'image', image: Buffer.from(img.data, 'base64'), mediaType: img.mediaType });
	}
	if (file) {
		parts.push({ type: 'file', data: Buffer.from(file.data, 'base64'), mediaType: file.mediaType });
	}
	return parts;
}

/** JSON vincolato sul gateway. Sostituisce structuredGemini / responseSchema Google. */
/**
 * Quanto ragiona il modello, DICHIARATO sempre.
 *
 * Il campo non veniva mandato mai, e il default non impostato del provider è patologico. Misurato
 * l'1/09/2026 su `z-ai/glm-5.3-flash`, stesso prompt e stesso schema:
 *
 *   campo assente (quello che l'app faceva)   12.134 token   1 elemento su 3 richiesti
 *   effort: low / medium / high                123-214 token   3 su 3
 *
 * Quello che conta è la colonna di destra: senza istruzioni il modello spende dodicimila token di
 * ragionamento e restituisce comunque la cosa sbagliata. È CORRETTEZZA, non velocità — i tempi in
 * quelle prove oscillavano troppo (glm fra 68s e 113s, gemini fra 4s e 27s) per dire altro, e su
 * OpenRouter la stessa richiesta può finire su provider diversi. Un effort QUALUNQUE, anche 'high',
 * riporta la risposta a essere giusta, ed è la ragione per cui questa costante non ha un valore
 * "non impostato".
 *
 * Su questo modello il reasoning non si può nemmeno spegnere: `{enabled:false}` risponde 400,
 * «Reasoning is mandatory for this endpoint».
 */
export const LLM_REASONING_EFFORT = (() => {
  const raw = env.LLM_REASONING_EFFORT?.trim().toLowerCase();
  return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : 'high';
})();

/** Il corpo extra che ogni chiamata porta con sé, mai vuoto: v. LLM_REASONING_EFFORT. */
const reasoningOptions = () => ({ reasoning: { effort: LLM_REASONING_EFFORT } });

/**
 * Quanto si aspetta una risposta dal centralino prima di considerarla persa.
 *
 * Non c'era: una chiamata appesa non tornava mai, e la pagina che l'aspettava nemmeno.
 *
 * IL NUMERO È GENEROSO PERCHÉ L'OUTPUT STRUTTURATO È LENTO, NON ROTTO. Misurato l'1/09/2026 sul
 * percorso vero (llmStructured → generateObject), stesso schema e stesso prompt:
 *
 *   z-ai/glm-5.3-flash        107s      (il default configurato)
 *   google/gemini-3.7-flash    15s
 *
 * Sette volte più lento, su uno schema PICCOLO. Quelli veri del planner — seed con battute,
 * venti campi — sono molto più grandi, quindi la scadenza deve stare larga o trasforma la
 * lentezza in un guasto: è l'errore che ho già fatto una volta leggendo una chiamata lunga come
 * un modello rotto. Si abbassa con LLM_TIMEOUT_MS quando si sa cosa si sta facendo.
 */
export const LLM_TIMEOUT_MS = Number(env.LLM_TIMEOUT_MS) > 0 ? Number(env.LLM_TIMEOUT_MS) : 900_000;

export async function llmStructured<T>(opts: {
	prompt: string;
	schema: Record<string, unknown>;
	system?: string;
	model?: string;
	images?: LlmMediaPart[];
	file?: LlmMediaPart;
	temperature?: number;
	label?: string;
}): Promise<T> {
	const modelId = opts.model ?? llmDefaultModel();
	const t0 = Date.now();
	const label = opts.label ?? 'llm.structured';
	try {
		const result = await generateObject({
			model: llmLanguageModel(modelId),
			schema: jsonSchema(opts.schema as never),
			system: opts.system,
			temperature: opts.temperature,
			abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
			providerOptions: { openai: reasoningOptions() },
			messages: [{ role: 'user', content: userContent(opts.prompt, opts.images, opts.file) }]
		});
		logAiCall({
			label,
			provider: 'llm',
			model: modelId,
			prompt: opts.prompt,
			ms: Date.now() - t0,
			ok: true,
			...extractSdkUsage(result.usage)
		});
		return result.object as T;
	} catch (e) {
		logAiCall({
			label,
			provider: 'llm',
			model: modelId,
			prompt: opts.prompt,
			ms: Date.now() - t0,
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		});
		throw e;
	}
}

export async function llmText(opts: {
	prompt: string;
	system?: string;
	model?: string;
	images?: LlmMediaPart[];
	file?: LlmMediaPart;
	/** Google Search nativo su un Gemini via OpenRouter (`plugins: web, engine: native`). */
	webSearch?: boolean;
	label?: string;
}): Promise<{ text: string; citations: Array<{ uri: string; title: string }> }> {
	const modelId = opts.model ?? (opts.webSearch ? llmGeminiSearchModel() : llmDefaultModel());
	const extra = opts.webSearch ? { plugins: [{ id: 'web', engine: 'native' }] } : undefined;
	const t0 = Date.now();
	const label = opts.label ?? (opts.webSearch ? 'llm.grounded' : 'llm.text');
	try {
		const result = await generateText({
			model: llmLanguageModel(modelId),
			system: opts.system,
			abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
			messages: [{ role: 'user', content: userContent(opts.prompt, opts.images, opts.file) }],
			providerOptions: { openai: { ...reasoningOptions(), ...(extra ?? {}) } }
		});
		const citations: Array<{ uri: string; title: string }> = [];
		const seen = new Set<string>();
		const sources = (result as { sources?: Array<{ url?: string; title?: string }> }).sources ?? [];
		for (const s of sources) {
			const uri = s?.url;
			if (uri && !seen.has(uri)) {
				seen.add(uri);
				citations.push({ uri, title: s.title ?? uri });
			}
		}
		logAiCall({
			label,
			provider: 'llm',
			model: modelId,
			prompt: opts.prompt,
			ms: Date.now() - t0,
			ok: true,
			...extractSdkUsage(result.usage)
		});
		return { text: result.text ?? '', citations };
	} catch (e) {
		logAiCall({
			label,
			provider: 'llm',
			model: modelId,
			prompt: opts.prompt,
			ms: Date.now() - t0,
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		});
		throw e;
	}
}

export async function llmEmbed(texts: string[]): Promise<(number[] | null)[]> {
	if (!texts.length) return [];
	const modelId = llmEmbeddingModel();
	const t0 = Date.now();
	try {
		const result = await embedMany({
			model: llmClient().embedding(modelId),
			values: texts,
			providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } }
		});
		logAiCall({
			label: 'llm.embed',
			provider: 'llm',
			model: modelId,
			ms: Date.now() - t0,
			ok: true,
			inputTokens: Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4)
		});
		return result.embeddings.map((e) => (e?.length === EMBEDDING_DIMENSIONS ? [...e] : null));
	} catch (e) {
		logAiCall({
			label: 'llm.embed',
			provider: 'llm',
			model: modelId,
			ms: Date.now() - t0,
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		});
		throw e;
	}
}

export const LYRIA_CLIP = 'google/lyria-3-clip-preview';
export const LYRIA_PRO = 'google/lyria-3-pro-preview';
export const LYRIA_CLIP_SECONDS = 30;
export const LYRIA_COST_USD: Record<string, number> = {
	[LYRIA_CLIP]: 0.04,
	[LYRIA_PRO]: 0.08
};

export type MusicTier = 'clip' | 'pro';

export function lyriaModel(tier: MusicTier): string {
	return tier === 'pro' ? LYRIA_PRO : LYRIA_CLIP;
}

/**
 * Audio MP3 da una risposta OpenAI-compat (OpenRouter Lyria). Accetta sia `choices[].message`
 * con parti audio sia un JSON Interactions-like (`steps`).
 */
export function musicBytesFromChatCompletion(body: unknown): Uint8Array {
	const rec = body as {
		choices?: Array<{ message?: { audio?: { data?: string }; content?: unknown } }>;
		steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }>;
	};
	const fromChoice = rec.choices?.[0]?.message?.audio?.data;
	if (typeof fromChoice === 'string' && fromChoice) {
		return assertMp3(Buffer.from(fromChoice, 'base64'));
	}
	const content = rec.choices?.[0]?.message?.content;
	if (Array.isArray(content)) {
		for (const part of content as Array<{ type?: string; input_audio?: { data?: string }; audio?: { data?: string }; data?: string }>) {
			const data = part?.input_audio?.data ?? part?.audio?.data ?? (part?.type === 'audio' ? part.data : undefined);
			if (data) return assertMp3(Buffer.from(data, 'base64'));
		}
	}
	for (const step of rec.steps ?? []) {
		if (step?.type && step.type !== 'model_output') continue;
		for (const block of step.content ?? []) {
			if (block?.type === 'audio' && block.data) return assertMp3(Buffer.from(block.data, 'base64'));
		}
	}
	throw new Error('The music model returned no audio.');
}

function assertMp3(buf: Buffer): Uint8Array {
	const bytes = new Uint8Array(buf);
	const isMp3 =
		(bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
		(bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
	if (!isMp3) {
		throw new Error('The music model returned audio that is not MP3 — the pipeline stores .mp3.');
	}
	return bytes;
}

export async function llmChatCompletions(opts: {
	model: string;
	prompt: string;
	timeoutMs: number;
	abortSignal?: AbortSignal;
}): Promise<unknown> {
	const key = llmApiKey();
	if (!key) throw new Error('LLM_API_KEY is not configured');
	const res = await fetch(`${llmBaseUrl()}/chat/completions`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${key}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			model: opts.model,
			messages: [{ role: 'user', content: opts.prompt }]
		}),
		signal: AbortSignal.any([
			...(opts.abortSignal ? [opts.abortSignal] : []),
			AbortSignal.timeout(opts.timeoutMs)
		])
	});
	if (!res.ok) {
		const detail = (await res.text().catch(() => '')).slice(0, 300);
		throw new Error(`${opts.model} answered ${res.status}. ${detail}`);
	}
	return res.json();
}
