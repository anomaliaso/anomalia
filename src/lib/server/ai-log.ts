import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { gatewayRate } from '$lib/server/openrouter-models';
import { createAdminClient } from '$lib/server/supabase-admin';
import { GEMINI_FLASH, geminiFlash, isGeminiFlashId, isKieFlashId, kieFlashId, NANO_BANANA_PRO, isNanoBananaProId, geminiVisualCreditShare } from '$lib/server/gemini';

// Fire-and-forget observability: one ai_calls row per LLM call, written from the shared
// chokepoints. NEVER throws and never awaited — a missing table or a dead DB must not break AI.
//
// Brand attribution rides an AsyncLocalStorage so concurrent requests can't contaminate each
// other; entry points wrap their work in withBrandContext(brandId, fn).

type BrandLogContext = {
  brandId: string;
  /** Set when the caller already knows the plan. `undefined` = not resolved yet (look up). */
  plan?: string | null;
  /** Crediti kie letti dalle risposte HTTP di questo scope, in attesa della riga che li scrive. */
  kieCredits?: number;
  /** Costo fatturato dal gateway in questo scope, sommato: la fattura vera del turno. */
  llmCostUsd?: number;
};

const brandStorage = new AsyncLocalStorage<BrandLogContext>();

const PLAN_CACHE_TTL_MS = 60_000;
const planCache = new Map<string, { plan: string | null; at: number }>();

export function rememberBrandPlan(brandId: string, plan: string | null): void {
  planCache.set(brandId, { plan, at: Date.now() });
}

function cachedBrandPlan(brandId: string): string | null | undefined {
  const hit = planCache.get(brandId);
  if (!hit || Date.now() - hit.at >= PLAN_CACHE_TTL_MS) return undefined;
  return hit.plan;
}

async function resolveBrandPlan(brandId: string): Promise<string | null> {
  const cached = cachedBrandPlan(brandId);
  if (cached !== undefined) return cached;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('brands').select('plan').eq('id', brandId).maybeSingle();
    const plan = (data?.plan as string | null | undefined) ?? null;
    rememberBrandPlan(brandId, plan);
    return plan;
  } catch {
    return null;
  }
}

/**
 * Run `fn` in a brand-scoped async context: every AI call inside it, and in any async descendant,
 * resolves brandId from here. Pass `plan` when the brand row is already loaded, or `logAiCall`
 * looks it up (cached) before writing cost_usd.
 */
export function withBrandContext<T>(brandId: string, fn: () => T, plan?: string | null): T {
  const ctx: BrandLogContext = { brandId, plan };
  if (plan !== undefined) rememberBrandPlan(brandId, plan);
  else {
    const cached = cachedBrandPlan(brandId);
    if (cached !== undefined) ctx.plan = cached;
  }
  return brandStorage.run(ctx, fn);
}

/**
 * Crediti kie visti passare in questo scope, sommati. Il turno di chat passa dall'AI SDK, che
 * espone solo i token, quindi senza questa cassetta `provider_credits` è NULL per ogni turno:
 * `kieFetch` li deposita, `logAiCall` li ritira azzerando sulla prima riga kie che non ne ha.
 *
 * ponytail: i turni SSE non passano di qui — `kieFetch` non tocca il corpo di un event-stream,
 * per non bufferizzare la risposta davanti all'utente.
 */
export function noteKieCredits(credits: number): void {
  const ctx = brandStorage.getStore();
  if (!ctx || !Number.isFinite(credits) || credits <= 0) return;
  ctx.kieCredits = (ctx.kieCredits ?? 0) + credits;
}

function takeKieCredits(): number | undefined {
  const ctx = brandStorage.getStore();
  const credits = ctx?.kieCredits;
  if (!ctx || !credits) return undefined;
  ctx.kieCredits = 0;
  return credits;
}

/**
 * Il costo che il gateway ci ha fatturato in questo scope. Un turno di chat è N chiamate (una per
 * passo con i tool) e ognuna ha la sua fattura: si sommano qui e la riga aggregata le scrive,
 * esattamente come i crediti kie qui sopra. `llmClient` le deposita leggendo `usage.cost` da una
 * copia della risposta, senza rallentare quella che sta leggendo l'utente.
 */
export function noteLlmCost(usd: number): void {
  const ctx = brandStorage.getStore();
  if (!ctx || !Number.isFinite(usd) || usd < 0) return;
  ctx.llmCostUsd = (ctx.llmCostUsd ?? 0) + usd;
}

export function takeLlmCost(): number | undefined {
  const ctx = brandStorage.getStore();
  const cost = ctx?.llmCostUsd;
  if (!ctx || cost == null) return undefined;
  ctx.llmCostUsd = undefined;
  return cost;
}

/** $5 = 1000 crediti kie. */
export const KIE_CREDIT_USD = 0.005;

/** Read the active brandId from the current async scope (null = not in a brand context). */
export function getBrandContext(): string | null {
  return brandStorage.getStore()?.brandId ?? null;
}

/** `undefined` = no brand context / not resolved yet. `null` = free tier. */
export function getBrandPlanContext(): string | null | undefined {
  return brandStorage.getStore()?.plan;
}

/** Stamp the active scope + cache once a brands row is loaded. */
export function setBrandPlanContext(plan: string | null): void {
  const ctx = brandStorage.getStore();
  if (ctx) {
    ctx.plan = plan;
    rememberBrandPlan(ctx.brandId, plan);
  }
}

// One-time SYSTEM-initiated generation (onboarding) must always complete: it is acquisition cost,
// not brand spend, and it has its own runaway watchdog. Cost is still LOGGED; only the gate is off.
const creditExemptStorage = new AsyncLocalStorage<boolean>();

/** Run `fn` with the credit gate disabled (see gateCredits). Use only for one-time system flows. */
export function withCreditExempt<T>(fn: () => T): T {
  return creditExemptStorage.run(true, fn);
}

/** True when the current async scope is exempt from the credit gate. */
export function isCreditExempt(): boolean {
  return creditExemptStorage.getStore() === true;
}

/**
 * Missing context is LOGGED, not thrown: pre-brand flows (onboarding website analysis) have no
 * brand yet, and an unattributed row (`brand_id is null` finds the gaps) beats a 500 at the user.
 */
export function requireBrandContext(opts?: { brandId?: string }): string | null {
  const id = opts?.brandId ?? brandStorage.getStore()?.brandId;
  if (id) return id;
  console.error('[ai-log] AI call without brand context — credits will not be billed to any brand. Wrap the entry point in withBrandContext(brandId, fn).');
  return null;
}

export type AiCallLog = {
  label: string;
  // LLM providers plus every paid non-LLM API that bills brand credits, so one timeline covers
  // every external call. Non-obvious members:
  //   'pagespeed' free (Google quota), logged anyway; 'ads' is the management fee, not an API call;
  //   'submitforbacklinks' a flat per-submission fee; 'sandbox' microVM seconds.
  //   'internal' is an agent EVENT, not a call: `cost_usd` stays null, so it can't touch credits or
  //   rate limits (both filter `cost_usd is not null`) and the Usage page excludes it by provider.
  provider: 'gemini' | 'xiaomi' | 'kie' | 'openrouter' | 'opencode' | 'llm' | 'deepseek' | 'scrapecreators' | 'exa' | 'tavily' | 'dataforseo' | 'pagespeed' | 'ads' | 'submitforbacklinks' | 'sandbox' | 'internal';
  model?: string;
  // Flat per-request price for non-token providers; when set it wins over the token rates.
  flatCostUsd?: number;
  // kie.ai credits_consumed, observability only — brand billing still sums cost_usd.
  providerCredits?: number;
  prompt?: string; // hashed + measured, never stored
  ms: number;
  ok: boolean;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  thinkingTokens?: number;
  // IMAGE-modality output, billed at the image rate. SUBSET of outputTokens.
  imageOutputTokens?: number;
  // Google Search queries performed, $14/1k on Gemini 3.x past the 5k/month free tier.
  groundingQueries?: number;
  serviceTier?: string;
  brandId?: string;
  userId?: string;
  threadId?: string;
  context?: string;
};

// USD per 1M tokens. cachedTokens are a SUBSET of inputTokens, billed at the cache rate.
// `thinkingInOutput`: Gemini reports thoughts separately, MiMo already counts reasoning_tokens
// inside completion_tokens — adding them again would double-count.
// `searchPerQuery`: the free tiers are deliberately NOT modeled, so the number is a prudent upper
// bound. Same prudence everywhere below when two published figures disagree: take the higher.
const RATES: Record<string, { input: number; cachedInput: number; output: number; imageOutput?: number; searchPerQuery?: number; thinkingInOutput?: boolean }> = {
  // Current Flash, priced at the post-intro standard rate. When you bump GEMINI_FLASH, add a
  // historical alias below for the old id — and a kie rate for it, or `computeCostUsd` returns null.
  [GEMINI_FLASH]: { input: 1.5, cachedInput: 0.15, output: 7.5, searchPerQuery: 0.014 },
  // LO STESSO Flash via kie.ai, sotto l'id con i TRATTINI: l'id in `ai_calls.model` dice da solo
  // su quale trasporto è passata la riga, e le tariffe Google qui sopra non possono raggiungerla.
  //
  // `cachedInput` uguale a `input` NON è una svista: kie non ha tier di cache e rifattura ogni
  // token ripetuto a prezzo pieno, quindi su un turno molto cacheato costa DI PIÙ di Google.
  //
  // Tariffe e non `credits_consumed`: l'SDK @google/genai scarta quel campo costruendo la
  // risposta, e comunque sottostima (0.01 dichiarati contro 0.07 di saldo reale su cinque
  // chiamate identiche). Le tariffe sono la stima migliore: $0.00039 contro $0.00035 reali.
  [kieFlashId(GEMINI_FLASH)]: { input: 0.225, cachedInput: 0.225, output: 1.125 },
  'gemini-3-6-flash': { input: 0.225, cachedInput: 0.225, output: 1.125 },
  // Historical alias: rows logged before the 3.7 bump recompute at the rate they actually ran on.
  'gemini-3.6-flash': { input: 1.5, cachedInput: 0.15, output: 7.5, searchPerQuery: 0.014 },
  // Historical alias: the OLD 3.5 rate (output $9), for rows logged before the 3.6 bump.
  'gemini-3.5-flash': { input: 1.5, cachedInput: 0.15, output: 9, searchPerQuery: 0.014 },
  'gemini-embedding-001': { input: 0.15, cachedInput: 0.15, output: 0 },
  // openrouter. L'id si cerca anche senza il prefisso `openrouter/` che il bridge gli mette
  // davanti (vedi la normalizzazione in `computeCostUsd`): una riga non prezzata non tocca i
  // crediti, quindi un modello nuovo qui si aggiunge PRIMA di mandarci del traffico.
  'z-ai/glm-5.3-flash': { input: 0.075, cachedInput: 0.015, output: 0.25 },
  // Il tier pro, cioe` chi scrive le composizioni motion: 27x l'input e 40x l'output del fast.
  // Senza questa riga quei turni tornerebbero a `cost_usd` NULL — cioe` l'agente piu` caro del
  // prodotto smetterebbe di toccare i crediti proprio spostandolo sul modello piu` costoso.
  'openai/gpt-5.6-sol': { input: 2, cachedInput: 0.2, output: 10 },
  [NANO_BANANA_PRO]: { input: 2, cachedInput: 2, output: 12, imageOutput: 120 },
  // Nano Banana 2: docs and AI Studio disagree on image output ($30 vs $60/M) — the higher wins.
  'gemini-3.1-flash-image': { input: 0.5, cachedInput: 0.5, output: 3, imageOutput: 60 },
  // Nano Banana 2 Lite: no published Google rate found — priced at Nano Banana 2 as the prudent
  // upper bound. On kie (the default transport) the real cost comes from credits_consumed anyway.
  'gemini-3.1-flash-lite-image': { input: 0.5, cachedInput: 0.5, output: 3, imageOutput: 60 },
  'mimo-v2.5-pro': { input: 0.435, cachedInput: 0.0036, output: 0.87, searchPerQuery: 0.005, thinkingInOutput: true },
  // The only MiMo that accepts image input; used as the vision model.
  'mimo-v2.5': { input: 0.14, cachedInput: 0.003, output: 0.28, searchPerQuery: 0.005, thinkingInOutput: true },
  'mimo-v2.5-pro-ultraspeed': { input: 1.305, cachedInput: 0.0108, output: 2.61, searchPerQuery: 0.005, thinkingInOutput: true },
  // DeepSeek ha una fascia oraria: peak 01:00-04:00 e 06:00-10:00 UTC si paga il DOPPIO, e i
  // nostri cron ci cadono quasi tutti dentro (06:00-09:00). Qui teniamo la tariffa PEAK.
  'deepseek-v4-flash': { input: 0.44, cachedInput: 0.014, output: 1.32 },
  'deepseek-v4-pro': { input: 1.32, cachedInput: 0.044, output: 3.96 },
  // Grok via kie: fallback token rates — flatCostUsd from credits_consumed wins when present.
  'grok-4-5': { input: 0.8, cachedInput: 0.2, output: 2.4 },
  'grok-4-6': { input: 0.8, cachedInput: 0.2, output: 2.4 },
  // Citation-tier kie models, same fallback.
  'grok-4-3': { input: 0.5, cachedInput: 0.125, output: 1.5 },
  'gpt-5-6-luna': { input: 0.056, cachedInput: 0.0056, output: 0.336 },
  'gpt-5-6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5-6-sol': { input: 5, cachedInput: 0.5, output: 30 },
  'claude-haiku-4-5': { input: 0.8, cachedInput: 0.08, output: 4 }
};

function usesGeminiVisualCreditShare(entry: AiCallLog): boolean {
  return isGeminiFlashId(entry.model) || (!entry.model && entry.provider === 'gemini') || isNanoBananaProId(entry.model);
}

function planForVisualShare(explicit?: string | null): string | null | undefined {
  if (explicit !== undefined) return explicit;
  const fromAls = getBrandPlanContext();
  if (fromAls !== undefined) return fromAls;
  const brandId = getBrandContext();
  if (brandId) return cachedBrandPlan(brandId);
  return undefined;
}

// null = not computable (no usage, unknown model). A MISSING model on a gemini call means Flash;
// `plan` is accepted for the call sites that still thread one, and no longer changes the price.
export function computeCostUsd(entry: AiCallLog, plan?: string | null): number | null {
  // Flat-fee providers: la richiesta fallita non ce la fatturano, quindi non la fatturiamo.
  // LA SANDBOX È L'ECCEZIONE: la microVM è stata accesa e ha consumato tempo macchina comunque.
  // Esentarla su `ok = false` rendeva gratis il percorso più caro (32,1% dei secondi misurati non
  // addebitati a nessuno) — cioè l'invito a riprovare all'infinito.
  if (entry.flatCostUsd != null) {
    if (entry.ok || entry.provider === 'sandbox') return Math.round(entry.flatCostUsd * 1e6) / 1e6;
    return null;
  }
  if (entry.inputTokens == null && entry.outputTokens == null) return null;
  // Una riga kie non può cadere sulle tariffe Google: sono 16× il costo reale e niente fallisce.
  // Id kie senza tariffa → null, un buco interrogabile invece di un numero sbagliato credibile.
  if (isKieFlashId(entry.model) && !RATES[entry.model ?? '']) return null;
  // Modello ASSENTE su una chiamata gemini = Flash; modello PRESENTE ma ignoto deve restare null,
  // non essere prezzato come Flash.
  // `openrouter/z-ai/glm-5.3-flash`, `llm/z-ai/glm-5.3-flash` e `z-ai/glm-5.3-flash` sono lo
  // stesso modello allo stesso prezzo: il prefisso dice il trasporto, non la tariffa. Il bridge
  // dell'harness scrive `llm/`, e finché la normalizzazione ne toglieva uno solo quelle righe
  // restavano senza costo — 54 su 235 dello stesso modello.
  const modelKey = (entry.model ?? '').replace(/^(?:openrouter|llm)\//, '');
  const rate =
    RATES[modelKey] ??
    // Il listino del gateway, chiesto al gateway: è ciò che rende fatturabile un modello che
    // l'utente ha scelto e che nessuno ha scritto qui sopra. Vuoto finché `ensureGatewayModels`
    // non ha caricato — e allora decidono le RATES, come prima.
    gatewayRate(entry.model) ??
    (isGeminiFlashId(entry.model) ? RATES[GEMINI_FLASH] : null) ??
    (!entry.model && entry.provider === 'gemini' ? RATES[GEMINI_FLASH] : null);
  if (!rate) return null;
  const input = entry.inputTokens ?? 0;
  const cached = Math.min(entry.cachedTokens ?? 0, input);
  const output = entry.outputTokens ?? 0;
  const imageOut = Math.min(entry.imageOutputTokens ?? 0, output);
  const thinking = rate.thinkingInOutput ? 0 : (entry.thinkingTokens ?? 0);
  const usd =
    ((input - cached) * rate.input +
      cached * rate.cachedInput +
      (output - imageOut + thinking) * rate.output +
      imageOut * (rate.imageOutput ?? rate.output)) /
      1e6 +
    (entry.groundingQueries ?? 0) * (rate.searchPerQuery ?? 0);
  // Sempre 1 (vedi geminiVisualCreditShare): l'unica cucitura da cui uno sconto rientrerebbe.
  // cost_usd si scrive QUI, al log — le righe vecchie tengono la share in vigore quando girarono.
  const share = usesGeminiVisualCreditShare(entry) ? geminiVisualCreditShare(planForVisualShare(plan)) : 1;
  return Math.round(usd * share * 1e6) / 1e6;
}

// Per i call site diretti che non passano dai chokepoint. Stesso contratto: logga successo e
// fallimento con i token, non inghiotte mai l'errore.
export async function loggedGemini<T>(label: string, fn: () => Promise<T>, extra?: Partial<AiCallLog>): Promise<T> {
  const brandId = requireBrandContext(extra);
  const t0 = Date.now();
  try {
    const res = await fn();
    logAiCall({ label, provider: 'gemini', model: geminiFlash(), ms: Date.now() - t0, ok: true, ...extractGeminiUsage(res), ...extra, brandId: extra?.brandId ?? brandId ?? undefined });
    return res;
  } catch (e) {
    logAiCall({ label, provider: 'gemini', model: geminiFlash(), ms: Date.now() - t0, ok: false, error: e instanceof Error ? e.message : String(e), ...extra, brandId: extra?.brandId ?? brandId ?? undefined });
    throw e;
  }
}

export function promptHash(prompt: string | undefined): string | null {
  if (!prompt) return null;
  return createHash('sha1').update(prompt).digest('hex').slice(0, 10);
}

export function logAiCall(entry: AiCallLog): void {
  try {
    // Il costo resta quello delle RATES: i credits_consumed sottostimano, valgono come
    // osservabilità e non come prezzo.
    if (entry.provider === 'kie' && entry.providerCredits == null) {
      const credits = takeKieCredits();
      if (credits != null) entry = { ...entry, providerCredits: credits };
    }
    // La fattura vera del gateway, se questo turno ne ha lasciata una. Si ritira QUI, sincrono:
    // dopo il primo await un'altra riga dello stesso scope se la porterebbe via.
    if (entry.provider === 'llm' && entry.flatCostUsd == null) {
      const billed = takeLlmCost();
      // Il prezzo del gateway batte le RATES scritte a mano: copre il modello che ha risposto
      // davvero, il provider a monte e il markup, e vale per un modello che nessuno ha listato.
      if (billed != null) entry = { ...entry, flatCostUsd: billed };
    }
    const admin = createAdminClient();
    const brandId = entry.brandId ?? getBrandContext();
    const planFromAls = getBrandPlanContext();
    void (async () => {
      const plan =
        planFromAls !== undefined ? planFromAls : brandId ? await resolveBrandPlan(brandId) : null;
      // Il listino serve PRIMA di prezzare, e solo per le righe che possono averne bisogno: la
      // prima chiamata del processo lo carica, le altre lo trovano in memoria.
      if (entry.provider === 'llm' && entry.flatCostUsd == null) {
        const { ensureGatewayModels } = await import('$lib/server/openrouter-models');
        await ensureGatewayModels();
      }
      const { error } = await admin.from('ai_calls').insert({
        label: entry.label,
        provider: entry.provider,
        model: entry.model ?? null,
        prompt_hash: promptHash(entry.prompt),
        prompt_chars: entry.prompt ? entry.prompt.length : null,
        ms: Math.round(entry.ms),
        ok: entry.ok,
        error: entry.error ? String(entry.error).slice(0, 500) : null,
        input_tokens: entry.inputTokens ?? null,
        output_tokens: entry.outputTokens ?? null,
        cached_tokens: entry.cachedTokens ?? null,
        thinking_tokens: entry.thinkingTokens ?? null,
        grounding_queries: entry.groundingQueries ?? null,
        cost_usd: computeCostUsd(entry, plan),
        provider_credits: entry.providerCredits ?? null,
        service_tier: entry.serviceTier ?? null,
        // Fallback allo scope: attribuisce anche i chokepoint che non passano brandId. Esplicito vince.
        brand_id: brandId,
        user_id: entry.userId ?? null,
        thread_id: entry.threadId ?? null,
        context: entry.context ?? null
      });
      if (error) console.warn('[ai-log] insert failed:', error.message);
    })();
  } catch {
    // no admin client (missing env) — observability is optional, AI keeps working
  }
}

export type SdkUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  thinkingTokens?: number;
};

export function extractSdkUsage(usage: unknown): SdkUsage {
  if (!usage || typeof usage !== 'object') return {};
  const u = usage as {
    inputTokens?: unknown;
    outputTokens?: unknown;
    inputTokenDetails?: InputTokenDetails;
    outputTokenDetails?: { reasoningTokens?: unknown };
    cachedInputTokens?: unknown;
    reasoningTokens?: unknown;
  };
  const input = tokenCount(u.inputTokens);
  const outside = u.inputTokenDetails ? cacheOutsideInput(u.inputTokenDetails) : undefined;
  return {
    inputTokens: input == null || outside == null ? input : input + outside,
    outputTokens: tokenCount(u.outputTokens),
    cachedTokens: tokenCount(u.inputTokenDetails?.cacheReadTokens) ?? tokenCount(u.cachedInputTokens),
    thinkingTokens: tokenCount(u.outputTokenDetails?.reasoningTokens) ?? tokenCount(u.reasoningTokens)
  };
}

type InputTokenDetails = { noCacheTokens?: unknown; cacheReadTokens?: unknown; cacheWriteTokens?: unknown };

function cacheOutsideInput(details: InputTokenDetails): number | undefined {
  if (tokenCount(details.noCacheTokens) != null) return undefined;
  const read = tokenCount(details.cacheReadTokens) ?? 0;
  const write = tokenCount(details.cacheWriteTokens) ?? 0;
  return read + write > 0 ? read + write : undefined;
}

function tokenCount(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Token usage from a Gemini response, or undefined when the API didn't report any. */
export function extractGeminiUsage(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  imageOutputTokens: number;
  serviceTier: string;
} | undefined {
  const res = response as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      cachedContentTokenCount?: number;
      thoughtsTokenCount?: number;
      // kie manda `thinkingTokenCount` dove Google manda `thoughtsTokenCount`: senza, i token di
      // ragionamento loggano zero, e sono il 38% della spesa di Flash.
      thinkingTokenCount?: number;
      promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
      candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
      serviceTier?: string;
    };
  } | undefined;
  if (!res?.usageMetadata) return undefined;
  const meta = res.usageMetadata;
  const imageOutputTokens = (meta.candidatesTokensDetails ?? [])
    .filter((d) => d.modality === 'IMAGE')
    .reduce((sum, d) => sum + (d.tokenCount ?? 0), 0);
  return {
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: meta.candidatesTokenCount ?? 0,
    cachedTokens: meta.cachedContentTokenCount ?? 0,
    thinkingTokens: meta.thoughtsTokenCount ?? meta.thinkingTokenCount ?? 0,
    imageOutputTokens,
    serviceTier: meta.serviceTier ?? ''
  };
}

/** Token usage from a Xiaomi/OpenAI-compatible response, or undefined when absent. */
export function extractXiaomiUsage(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  groundingQueries: number;
  serviceTier: string;
} | undefined {
  const res = response as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
      // Xiaomi web_search: nested inside usage, `tool_usage` = billable invocations ($5/1k).
      web_search_usage?: { tool_usage?: number; page_usage?: number };
    };
    web_search_usage?: { tool_usage?: number; page_usage?: number };
  } | undefined;
  if (!res?.usage) return undefined;
  const u = res.usage;
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    // SUBSET of completion_tokens: `thinkingInOutput` stops computeCostUsd pricing them twice.
    thinkingTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    groundingQueries: u.web_search_usage?.tool_usage ?? res.web_search_usage?.tool_usage ?? 0,
    serviceTier: ''
  };
}
