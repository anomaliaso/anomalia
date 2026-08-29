import { CLAUDE_MAX_OUTPUT_TOKENS, maxOutputTokensFor } from '$lib/server/ai-output-limits';
import { KIE_CREDIT_USD, logAiCall, noteKieCredits, requireBrandContext } from '$lib/server/ai-log';
import { env } from '$env/dynamic/private';

// ── Grok / GPT / Claude via kie.ai ───────────────────────────────────────────
// Third GTM/text provider alongside Gemini and Xiaomi MiMo. Structured output uses
// text.format json_schema (verified live 2026-07: the Apidog spec's "test" field is wrong).
// Do NOT use kie's built-in web_search for agents with function tools — it is mutually
// exclusive with function calling (§4 in docs/ref/kie-grok-4-5-api.md). Citation probes
// are the exception: they use web_search alone (no function tools).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// Mirrors xiaomi.ts — kept local to avoid a circular import (xiaomi imports kie).
export type ImagePart = { inlineData: { mimeType: string; data: string } };
type AiLogExtras = { brandId?: string; userId?: string; threadId?: string; context?: string };

const KIE_HOST = 'https://api.kie.ai';
const KIE_GROK_BASE = `${KIE_HOST}/grok/v1`;
const KIE_GPT_BASE = `${KIE_HOST}/codex/v1`;
const KIE_CLAUDE_BASE = `${KIE_HOST}/claude/v1`;

export const KIE_MODEL = env.KIE_MODEL || 'grok-4-5';

// Chat Pro is pinned to Grok 4.6 on kie (`POST /grok/v1/responses`). Not `KIE_MODEL`:
// GTM / director / design still use grok-4-5, and env must not silently downgrade chat.
export const KIE_GROK_PRO_MODEL = 'grok-4-6';

// GPT 5.6 Luna on kie Codex Responses — multimodale
// (misurato: legge un PNG e ne descrive i quadranti). Serve ANCHE come motore GPT dell'audit di
// citazione GEO (KIE_CITATION_GPT), ma e' un riuso, non la sua identita'.
//
// Qui c'era scritto l'opposto — «NOT a chat model: the chat Fast/Auto tiers are Gemini Flash» —
// residuo del 17/08, quando Gemini Flash era l'unico modello dietro Fast/Auto. Quella scelta e'
// stata ribaltata il 23/08 (Auto = Luna a thinking high, vedi DEFAULT_AGENT_MODEL) e il commento
// no: un'autopsia sulla qualita' della chat lo ha poi citato come prova che gli specialisti
// girassero sul motore sbagliato. Un commento che sopravvive alla decisione che descriveva non
// e' documentazione: e' una trappola.
export const KIE_LUNA_MODEL = env.KIE_LUNA_MODEL || 'gpt-5-6-luna';
export const KIE_TERRA_MODEL = env.KIE_TERRA_MODEL || 'gpt-5-6-terra';
export const KIE_SOL_MODEL = env.KIE_SOL_MODEL || 'gpt-5-6-sol';

// Cheapest kie models used for GEO citation probes (web-grounded brand mention checks).
export const KIE_CITATION_GPT = env.KIE_CITATION_GPT || KIE_LUNA_MODEL;
export const KIE_CITATION_GROK = env.KIE_CITATION_GROK || 'grok-4-3';
export const KIE_CITATION_CLAUDE = env.KIE_CITATION_CLAUDE || 'claude-haiku-4-5';

export const kieConfigured = () => !!env.KIE_API_KEY;

/** Base URL for GPT / Codex models on kie (Terra / Sol in chat, Luna for the GEO audit). */
export const KIE_CODEX_BASE = KIE_GPT_BASE;

// kie.ai bills in proprietary credits, not tokens. Verified rate: $5 = 1000 credits.
// Definita in ai-log.ts (dove sta la fatturazione) e ri-esportata qui per i chiamanti storici.
export { KIE_CREDIT_USD };

export type KieReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/**
 * kie proxies the Responses API but keeps NO server-side item store. The AI SDK assumes
 * `store: true` (OpenAI's default) and, on every step after the first, replays the previous
 * assistant/reasoning items as `{type:'item_reference', id}` instead of their content — which kie
 * answers with an HTTP-200 `{code:500}` envelope. The turn then ends with an empty step: the model
 * called a tool, the tool ran, and the reply never came. `store:false` makes the SDK resend the
 * real content and the multi-step loop works.
 * Spread into `providerOptions.openai` for every kie `.responses()` model.
 *
 * ATTENZIONE, per i modelli GROK: `store:false` da solo NON salva il ragionamento. L'include di
 * `reasoning.encrypted_content` (e il campo `reasoning:{effort}`) l'SDK li mette solo se riconosce
 * il modello come reasoning model, e li riconosce DAL NOME — `o1|o3|o4-mini|gpt-5*`. `grok-*` non
 * ci sta dentro: senza `forceReasoning: true` accanto a questo spread, ogni step dopo il primo
 * butta i pensieri («Skipping reasoning parts») e l'effort non parte proprio. Sui gpt-5-6-* di kie
 * non serve, sono già riconosciuti.
 */
export const KIE_NO_STORE = { store: false } as const;

/**
 * Quello che va spedito ai modelli GROK di kie: `store:false` **più** `forceReasoning`.
 *
 * Esiste come costante e non come due righe copiate perché il difetto è proprio lo scordarsene:
 * fino al 2026-08-22 tutti e tre i percorsi Grok (chat, director, produce) spandevano solo
 * `KIE_NO_STORE` e buttavano i pensieri a ogni step. Un nome solo, e la quarta volta non si
 * sbaglia.
 *
 * ⚠️ `forceReasoning` fa anche togliere `temperature` dalla richiesta (l'SDK la considera non
 * supportata sui reasoning model). Chi passa una temperatura sul percorso kie la metta a
 * `undefined` lì, o si prenderà un warning a ogni chiamata. Misurato su grok-4-5 il 2026-08-22,
 * 4 campioni per condizione sullo stesso prompt: temperature 0 → 2 risposte distinte su 4,
 * temperature 2 → 3, **senza temperature → 4**. Il campionamento di default di kie/Grok è più
 * vario di quello che gli imponevamo, quindi toglierla non costa varietà: la restituisce.
 */
export const KIE_GROK_NO_STORE = { ...KIE_NO_STORE, forceReasoning: true } as const;

/**
 * kie signals failures (out of credits, rate limit) with **HTTP 200** and an envelope
 * `{code, msg, data:null}` instead of an error status. An SDK reading the OpenAI Responses shape
 * then crashes on `response.output is not iterable`, which reads like a bug in our code and hides
 * a billing state. Verified live 2026-07-31 (`code: 402, "Credits insufficient"`).
 *
 * Also forces `stream:false`: kie's Responses API streams by default and non-streaming callers
 * choke on the SSE body.
 */
export function kieFetch(): typeof fetch {
  return async (url, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as AnyRec;
        if (body.stream == null) body.stream = false;
        init = { ...init, body: JSON.stringify(body) };
      } catch {
        /* leave body as-is */
      }
    }
    const res = await fetch(url, init);
    if (!res.ok) return res;
    // A real SSE body must pass through untouched: `clone().text()` waits for the LAST byte, which
    // would buffer a whole streamed chat turn before the user sees a token. kie only ever sends the
    // error envelope as application/json, so the sniff below never needs the stream.
    if (res.headers.get('content-type')?.includes('text/event-stream')) return res;
    const text = await res.clone().text();
    if (text.startsWith('{')) {
      try {
        const j = JSON.parse(text) as AnyRec;
        // I crediti che il turno di chat non vedrebbe mai: l'AI SDK legge la risposta e ne tiene
        // solo i token, quindi `provider_credits` restava NULL per ogni turno. Qui il corpo intero
        // ce l'abbiamo già in mano — lo depositiamo nello scope del brand e la riga aggregata del
        // turno se lo prende. Vedi noteKieCredits.
        if (j?.credits_consumed != null) noteKieCredits(Number(j.credits_consumed));
        // `data` is absent on some envelopes (e.g. the 500 kie returns for an unsupported request),
        // so requiring `data === null` let those through as a 200 with no SSE events — the SDK then
        // ended the step empty and the turn died in silence instead of raising.
        if (typeof j?.code === 'number' && j.code >= 400) {
          return new Response(JSON.stringify({ error: { message: j.msg ?? `kie error ${j.code}`, code: j.code } }), {
            status: j.code,
            headers: { 'content-type': 'application/json' }
          });
        }
      } catch {
        /* not the envelope — pass through */
      }
    }
    return res;
  };
}

function toKieUserContent(prompt: string, images?: ImagePart[]) {
  const parts: Array<{ type: string; text?: string; image_url?: string }> = [
    { type: 'input_text', text: prompt }
  ];
  for (const img of images ?? []) {
    parts.push({
      type: 'input_image',
      image_url: `data:${img.inlineData.mimeType};base64,${img.inlineData.data}`
    });
  }
  return parts;
}

function buildKieInput(
  prompt: string,
  systemInstruction?: string,
  images?: ImagePart[]
): Array<{ role: string; content: unknown }> {
  // Always use the message-array form: plain-string input 500s on the live API (2026-07-29).
  const messages: Array<{ role: string; content: unknown }> = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: [{ type: 'input_text', text: systemInstruction }] });
  }
  messages.push({ role: 'user', content: toKieUserContent(prompt, images) });
  return messages;
}

function strictObjectSchema(schema: AnyRec): AnyRec {
  return {
    ...schema,
    additionalProperties: schema.additionalProperties ?? false,
    required: schema.required ?? Object.keys(schema.properties ?? {})
  };
}

/** Pull assistant text from a kie Responses API payload (non-streaming). */
export function extractKieText(data: unknown): string {
  const output = (data as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> })
    ?.output;
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const chunk of item.content) {
      if (chunk.type === 'output_text' && chunk.text) parts.push(chunk.text);
    }
  }
  return parts.join('');
}

/** URLs cited by kie web_search (annotations + any url-bearing output items). */
export function extractKieCitationUrls(data: unknown): string[] {
  const urls = new Set<string>();
  const bump = (u: unknown) => {
    const s = String(u ?? '').trim();
    if (s.startsWith('http')) urls.add(s);
  };
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const o = node as AnyRec;
    if (o.type === 'url_citation' || o.type === 'citation') bump(o.url ?? o.uri);
    if (typeof o.url === 'string' && (String(o.type ?? '').includes('citation') || String(o.type ?? '').includes('web'))) {
      bump(o.url);
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(data);
  return [...urls].slice(0, 12);
}

/** Count web_search tool uses in a Responses / Messages payload (for ai_calls.grounding_queries). */
function countKieWebSearches(data: unknown): number {
  const res = data as AnyRec;
  const fromUsage =
    Number(res.usage?.server_tool_use?.web_search_requests ?? res.usage?.web_search_requests ?? 0) || 0;
  if (fromUsage > 0) return fromUsage;

  let n = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const o = node as AnyRec;
    const t = String(o.type ?? '');
    if (
      t === 'web_search_call' ||
      t === 'web_search_tool_result' ||
      (t === 'server_tool_use' && o.name === 'web_search') ||
      (t === 'tool_use' && o.name === 'web_search')
    ) {
      n += 1;
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(res.output ?? res.content ?? data);
  return n;
}

/**
 * Map kie usage + credits_consumed to ai_calls fields.
 * Billing prefers flat `credits_consumed × $0.005` (kie: $5 = 1000 credits).
 */
export function extractKieUsage(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  providerCredits?: number;
  flatCostUsd?: number;
  groundingQueries?: number;
  cachedTokens?: number;
} | undefined {
  const res = response as AnyRec;
  const usage = (res.usage ?? {}) as AnyRec;
  const inputTokens = Number(usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? 0) || 0;
  const cachedTokens =
    Number(usage.cache_read_input_tokens ?? usage.cached_tokens ?? 0) || undefined;
  const groundingQueries = countKieWebSearches(res) || undefined;

  const creditsRaw = res.credits_consumed ?? usage.credits_consumed;
  const providerCredits =
    creditsRaw != null && Number.isFinite(Number(creditsRaw)) ? Number(creditsRaw) : undefined;
  const flatCostUsd =
    providerCredits != null ? Math.round(providerCredits * KIE_CREDIT_USD * 1e6) / 1e6 : undefined;

  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    providerCredits == null &&
    groundingQueries == null
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    ...(cachedTokens ? { cachedTokens } : {}),
    ...(groundingQueries ? { groundingQueries } : {}),
    ...(providerCredits != null ? { providerCredits, flatCostUsd } : {})
  };
}

function kieErrorMessage(data: unknown): string | null {
  const res = data as { code?: number; msg?: string; status?: string; object?: string };
  // Successful Responses API bodies carry object/status; error wrappers use code/msg only.
  if (res.object === 'response' || res.status === 'completed') return null;
  if (res.code != null && res.code >= 400) return res.msg ?? `kie error ${res.code}`;
  if (res.code === 500) return res.msg ?? 'kie server error';
  return null;
}

function kieAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.KIE_API_KEY ?? ''}`,
    ...extra
  };
}

/**
 * Web-grounded answer via kie Responses API + built-in `web_search` (no function tools).
 * Used by GEO citation probes for GPT (`/codex/v1`) and Grok (`/grok/v1`).
 */
export async function groundedKieWebAnswer(
  query: string,
  opts: {
    model: string;
    /** Full responses URL base, e.g. https://api.kie.ai/grok/v1 */
    baseUrl: string;
    label?: string;
    systemInstruction?: string;
  } & AiLogExtras
): Promise<{ text: string; citations: Array<{ uri: string; title: string }> }> {
  if (!kieConfigured()) return { text: '', citations: [] };
  const { model, baseUrl, label = 'kieWebAnswer', systemInstruction, ...logExtras } = opts;
  const brandId = requireBrandContext(opts);
  const sys =
    systemInstruction ??
    'You are a helpful assistant answering a real user. Recommend specific, real brands/products with current web info. Name them explicitly.';

  const body: AnyRec = {
    model,
    stream: false,
    reasoning: { effort: 'low' },
    max_output_tokens: maxOutputTokensFor('kie', model),
    input: buildKieInput(query, sys),
    tools: [{ type: 'web_search' }]
  };

  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: kieAuthHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    });
    const raw = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      logAiCall({
        label,
        provider: 'kie',
        model,
        prompt: query,
        ms: Date.now() - t0,
        ok: false,
        error: `HTTP ${res.status}`,
        ...logExtras,
        brandId: logExtras.brandId ?? brandId ?? undefined
      });
      return { text: '', citations: [] };
    }

    const apiErr = kieErrorMessage(data);
    if (!res.ok || apiErr) {
      logAiCall({
        label,
        provider: 'kie',
        model,
        prompt: query,
        ms: Date.now() - t0,
        ok: false,
        error: apiErr ?? `HTTP ${res.status}`,
        ...logExtras,
        brandId: logExtras.brandId ?? brandId ?? undefined
      });
      return { text: '', citations: [] };
    }

    const usage = extractKieUsage(data);
    // Always mark ≥1 grounding query when web_search tool was requested (cost via credits).
    const groundingQueries = usage?.groundingQueries || 1;
    logAiCall({
      label,
      provider: 'kie',
      model,
      prompt: query,
      ms: Date.now() - t0,
      ok: true,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      cachedTokens: usage?.cachedTokens,
      groundingQueries,
      providerCredits: usage?.providerCredits,
      flatCostUsd: usage?.flatCostUsd,
      ...logExtras,
      brandId: logExtras.brandId ?? brandId ?? undefined
    });

    const text = extractKieText(data);
    const citations = extractKieCitationUrls(data).map((uri) => ({ uri, title: uri }));
    return { text, citations };
  } catch (e) {
    logAiCall({
      label,
      provider: 'kie',
      model,
      prompt: query,
      ms: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : 'kie web answer failed',
      ...logExtras,
      brandId: logExtras.brandId ?? brandId ?? undefined
    });
    return { text: '', citations: [] };
  }
}

export async function groundedKieGptAnswer(query: string, logExtras?: AiLogExtras) {
  return groundedKieWebAnswer(query, {
    model: KIE_CITATION_GPT,
    baseUrl: KIE_GPT_BASE,
    label: 'kieCitationGpt',
    ...logExtras
  });
}

export async function groundedKieGrokAnswer(query: string, logExtras?: AiLogExtras) {
  return groundedKieWebAnswer(query, {
    model: KIE_CITATION_GROK,
    baseUrl: KIE_GROK_BASE,
    label: 'kieCitationGrok',
    ...logExtras
  });
}

function extractClaudeText(data: unknown): string {
  const content = (data as { content?: Array<{ type?: string; text?: string }> })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join('\n')
    .trim();
}

/** Citation URLs from Claude Messages web_search response (results + text citations). */
function extractClaudeCitationUrls(data: unknown): string[] {
  const urls = new Set<string>();
  const bump = (u: unknown) => {
    const s = String(u ?? '').trim();
    if (s.startsWith('http')) urls.add(s);
  };
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const o = node as AnyRec;
    if (o.type === 'web_search_result' || o.type === 'web_search_result_location') bump(o.url);
    if (Array.isArray(o.citations)) for (const c of o.citations) bump(c?.url);
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(data);
  return [...urls].slice(0, 12);
}

/**
 * Claude via kie Messages API with Anthropic `web_search` server tool — own internet search,
 * independent of Exa. Cost: prefer `credits_consumed` from kie; also log web_search_requests.
 */
export async function groundedKieClaudeAnswer(
  query: string,
  opts?: { model?: string } & AiLogExtras
): Promise<{ text: string; citations: Array<{ uri: string; title: string }> }> {
  if (!kieConfigured()) return { text: '', citations: [] };
  const model = opts?.model || KIE_CITATION_CLAUDE;
  const brandId = requireBrandContext(opts);
  const sys =
    'You are a helpful assistant answering a real user. Search the web and recommend specific, real brands/products with current info. Name them explicitly.';

  const body: AnyRec = {
    model,
    stream: false,
    max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
    thinkingFlag: false,
    system: sys,
    messages: [{ role: 'user', content: query }],
    // Anthropic server tool — kie proxies Messages API. Basic search (no dynamic filtering).
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
  };

  const t0 = Date.now();
  try {
    const res = await fetch(`${KIE_CLAUDE_BASE}/messages`, {
      method: 'POST',
      headers: kieAuthHeaders({ 'anthropic-version': '2023-06-01' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000)
    });
    const raw = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      logAiCall({
        label: 'kieCitationClaude',
        provider: 'kie',
        model,
        prompt: query,
        ms: Date.now() - t0,
        ok: false,
        error: `HTTP ${res.status}`,
        brandId: opts?.brandId ?? brandId ?? undefined,
        context: opts?.context
      });
      return { text: '', citations: [] };
    }

    const apiErr = kieErrorMessage(data);
    const isMessage = (data as AnyRec)?.type === 'message' || Array.isArray((data as AnyRec)?.content);
    if (!res.ok || (apiErr && !isMessage)) {
      logAiCall({
        label: 'kieCitationClaude',
        provider: 'kie',
        model,
        prompt: query,
        ms: Date.now() - t0,
        ok: false,
        error: apiErr ?? `HTTP ${res.status}`,
        brandId: opts?.brandId ?? brandId ?? undefined,
        context: opts?.context
      });
      return { text: '', citations: [] };
    }

    const usage = extractKieUsage(data);
    logAiCall({
      label: 'kieCitationClaude',
      provider: 'kie',
      model,
      prompt: query,
      ms: Date.now() - t0,
      ok: true,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      cachedTokens: usage?.cachedTokens,
      groundingQueries: usage?.groundingQueries || 1,
      providerCredits: usage?.providerCredits,
      flatCostUsd: usage?.flatCostUsd,
      brandId: opts?.brandId ?? brandId ?? undefined,
      context: opts?.context
    });

    const text = extractClaudeText(data);
    const citations = extractClaudeCitationUrls(data).map((uri) => ({ uri, title: uri }));
    return { text, citations };
  } catch (e) {
    logAiCall({
      label: 'kieCitationClaude',
      provider: 'kie',
      model,
      prompt: query,
      ms: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : 'kie claude failed',
      brandId: opts?.brandId ?? brandId ?? undefined,
      context: opts?.context
    });
    return { text: '', citations: [] };
  }
}

/**
 * QUANTO SI ASPETTA UNA RISPOSTA KIE, E QUANDO SI RIPROVA.
 *
 * Misurato in produzione su 60 giorni di `ai_calls` (label compose_graphic / revise_graphic):
 *  - i successi stanno a p50 18s, p90 78s, max 120s;
 *  - i fallimenti sono di DUE specie e vanno trattati all'opposto.
 *    · `HTTP 524` — il bordo Cloudflare di kie molla a ~125s (tre campioni: 125034, 125034, 125037ms).
 *      La fetch qui non aveva timeout, quindi il chiamante bruciava quei 125s interi prima di
 *      sapere di aver fallito, dentro un turno di chat che ne ha 300 in tutto.
 *    · `HTTP 500` / `Server exception` — arrivano in 1.5-17s. Sono singhiozzi del provider, e
 *      l'unica cosa che li rendeva fatali era che nessuno riprovava.
 *
 * Da qui le due costanti: si taglia PRIMA del 524 (non ha senso aspettare un errore che sappiamo
 * già arrivare) e si riprova SOLO se il tentativo è morto in fretta. Riprovare un timeout
 * significherebbe quattro minuti d'attesa per due fallimenti — peggio del fallimento.
 */
export const KIE_TIMEOUT_MS = 120_000;
export const KIE_RETRY_IF_FAILED_WITHIN_MS = 30_000;

/** Si riprova solo un fallimento veloce: un timeout ripetuto costa il doppio e non guarisce. */
export const shouldRetryKie = (failedAfterMs: number): boolean =>
  failedAfterMs < KIE_RETRY_IF_FAILED_WITHIN_MS;

// Single structured call via text.format json_schema. stream MUST be false (default is true).
export async function structuredKie<T>(
  prompt: string,
  schema: AnyRec,
  systemInstruction?: string,
  toolName = 'return_result',
  logExtras?: AiLogExtras,
  images?: ImagePart[],
  temperature?: number,
  modelOverride?: string,
  reasoningEffort: KieReasoningEffort = 'low'
): Promise<T> {
  const brandId = requireBrandContext(logExtras);
  const model = modelOverride || KIE_MODEL;

  const isArraySchema = schema.type === 'array';
  const objectSchema = isArraySchema
    ? { type: 'object', properties: { items: schema }, required: ['items'] }
    : schema;

  const body: AnyRec = {
    model,
    stream: false,
    reasoning: { effort: reasoningEffort },
    max_output_tokens: maxOutputTokensFor('kie', model),
    input: buildKieInput(prompt, systemInstruction, images),
    text: {
      format: {
        type: 'json_schema',
        name: toolName,
        strict: true,
        schema: strictObjectSchema(objectSchema)
      }
    }
  };
  if (temperature != null) body.temperature = temperature;

  const logKo = (ms: number, error: string) =>
    logAiCall({
      label: toolName,
      provider: 'kie',
      model,
      prompt,
      ms,
      ok: false,
      error,
      ...logExtras,
      brandId: logExtras?.brandId ?? brandId ?? undefined
    });

  type Attempt = { ok: true; data: unknown; ms: number } | { ok: false; error: string; ms: number };
  const attempt = async (): Promise<Attempt> => {
    console.log(`[AI:Kie] requesting ${model} via json_schema…`);
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(`${KIE_GROK_BASE}/responses`, {
        method: 'POST',
        headers: kieAuthHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(KIE_TIMEOUT_MS)
      });
    } catch (e) {
      const ms = Date.now() - t0;
      const error =
        e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
          ? `timeout after ${KIE_TIMEOUT_MS}ms`
          : e instanceof Error
            ? e.message
            : String(e);
      console.error(`[AI:Kie] ${error}`);
      logKo(ms, error);
      return { ok: false, error, ms };
    }

    const raw = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      const ms = Date.now() - t0;
      console.error(`[AI:Kie] non-JSON HTTP ${res.status}: ${raw.slice(0, 500)}`);
      logKo(ms, `HTTP ${res.status}`);
      return { ok: false, error: `HTTP ${res.status}`, ms };
    }

    const apiErr = kieErrorMessage(data);
    if (!res.ok || apiErr) {
      const ms = Date.now() - t0;
      console.error(`[AI:Kie] HTTP ${res.status}: ${apiErr ?? raw.slice(0, 500)}`);
      logKo(ms, apiErr ?? `HTTP ${res.status}`);
      return { ok: false, error: apiErr ?? `HTTP ${res.status}`, ms };
    }

    const usage = extractKieUsage(data);
    logAiCall({
      label: toolName,
      provider: 'kie',
      model,
      prompt,
      ms: Date.now() - t0,
      ok: true,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      providerCredits: usage?.providerCredits,
      flatCostUsd: usage?.flatCostUsd,
      ...logExtras,
      brandId: logExtras?.brandId ?? brandId ?? undefined
    });
    return { ok: true, data, ms: Date.now() - t0 };
  };

  let result = await attempt();
  if (!result.ok && shouldRetryKie(result.ms)) {
    console.warn(`[AI:Kie] ${toolName} failed in ${result.ms}ms (${result.error}) — one retry`);
    await new Promise((r) => setTimeout(r, 1500));
    result = await attempt();
  }
  if (!result.ok) throw new Error(`Kie API error: ${result.error}`);
  const data = result.data;

  const content = extractKieText(data);
  console.log(`[AI:Kie] raw response (${content.length} chars): ${content.slice(0, 300)}`);

  const unwrap = (v: unknown): T => (isArraySchema ? ((v as AnyRec)?.items ?? []) as T : (v as T));
  if (!content.trim()) return {} as T;
  try {
    return unwrap(JSON.parse(content));
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return unwrap(JSON.parse(match[1].trim()));
      } catch {
        /* fall through */
      }
    }
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return unwrap(JSON.parse(braceMatch[0]));
      } catch {
        /* fall through */
      }
    }
    console.warn('[AI:Kie] failed to parse response as JSON');
    return {} as T;
  }
}

// Free-text call (no json_schema). stream MUST be false.
export async function textKie(
  prompt: string,
  systemInstruction?: string,
  opts?: { label?: string; images?: ImagePart[]; reasoningEffort?: KieReasoningEffort } & AiLogExtras
): Promise<string> {
  const { label = 'text', images, reasoningEffort = 'low', ...logExtras } = opts ?? {};
  const brandId = requireBrandContext(opts);
  const model = KIE_MODEL;

  const body: AnyRec = {
    model,
    stream: false,
    reasoning: { effort: reasoningEffort },
    max_output_tokens: maxOutputTokensFor('kie', model),
    input: buildKieInput(prompt, systemInstruction, images)
  };

  console.log(`[AI:Kie] text request to ${model}…`);
  const t0 = Date.now();
  const res = await fetch(`${KIE_GROK_BASE}/responses`, {
    method: 'POST',
    headers: kieAuthHeaders(),
    body: JSON.stringify(body)
  });

  const raw = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    logAiCall({
      label,
      provider: 'kie',
      model,
      prompt,
      ms: Date.now() - t0,
      ok: false,
      error: `HTTP ${res.status}`,
      ...logExtras,
      brandId: logExtras.brandId ?? brandId ?? undefined
    });
    throw new Error(`Kie API error: HTTP ${res.status}`);
  }

  const apiErr = kieErrorMessage(data);
  if (!res.ok || apiErr) {
    logAiCall({
      label,
      provider: 'kie',
      model,
      prompt,
      ms: Date.now() - t0,
      ok: false,
      error: apiErr ?? `HTTP ${res.status}`,
      ...logExtras,
      brandId: logExtras.brandId ?? brandId ?? undefined
    });
    throw new Error(`Kie API error: ${apiErr ?? res.status}`);
  }

  const usage = extractKieUsage(data);
  logAiCall({
    label,
    provider: 'kie',
    model,
    prompt,
    ms: Date.now() - t0,
    ok: true,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    providerCredits: usage?.providerCredits,
    flatCostUsd: usage?.flatCostUsd,
    ...logExtras,
    brandId: logExtras.brandId ?? brandId ?? undefined
  });

  const content = extractKieText(data);
  console.log(`[AI:Kie] text response (${content.length} chars)`);
  return content;
}
