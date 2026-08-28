// Resolve the LanguageModel for brand chat — every hub agent, peer consults and compaction.
//
// Tier (picker) e famiglia modello sono due assi:
//   Fast / Auto (default) → Luna (catalogo `luna`)
//   Pro                   → Grok 4.6
//   deepseek-pro / gpt-*  → famiglie omonime
//
// Su tier Auto la famiglia la decide l'AGENTE (`AgentSpec.model` in agent/specs.ts):
//   default e specialisti → Luna; solo motion → Grok (programma Remotion per davvero).
// Scala thinking comune + mappe native: `src/lib/models/catalog.ts`.
//
// Gemini resta ripiego senza chiave kie. Web search: Exa / DeepSeek tools, mai kie web_search.
import { maxOutputTokensFor } from '$lib/server/ai-output-limits';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { env } from '$env/dynamic/private';
import type { LanguageModel } from 'ai';
import { DEFAULT_CHAT_TIER, isChatTier, type ChatTier } from '$lib/chat-tiers';
import {
  DEFAULT_REASONING,
  coerceReasoning,
  deepseekThinking,
  geminiThinkingLevel,
  grokReasoningEffort,
  kieGptReasoningEffort,
  lunaReasoningEffort,
  type ChatReasoning
} from '$lib/chat-reasoning';
import { familyForTier, type ModelFamilyId } from '$lib/models/catalog';
import { modelPolicyForAgent } from '$lib/agent/specs';
import { turnModelFamily } from '$lib/chat-model-policy';
import { XIAOMI_MODEL } from '$lib/server/xiaomi';
import {
  KIE_GROK_PRO_MODEL,
  KIE_TERRA_MODEL,
  KIE_SOL_MODEL,
  KIE_LUNA_MODEL,
  KIE_CODEX_BASE,
  KIE_CREDIT_USD,
  KIE_NO_STORE,
  KIE_GROK_NO_STORE,
  kieFetch
} from '$lib/server/kie';
import { DEEPSEEK_PRO_MODEL } from '$lib/server/deepseek';
import { geminiFlash } from '$lib/server/gemini';

// Single source of truth in deepseek.ts; re-exported for the chat call sites that import it here.
export { DEEPSEEK_PRO_MODEL };

export type ChatModelResolved = {
  model: LanguageModel;
  provider: 'deepseek' | 'kie' | 'xiaomi' | 'gemini' | 'openrouter' | 'opencode';
  modelId: string;
  tier: ChatTier;
  /** Effort actually requested — logged so a slow turn can be explained after the fact. */
  reasoning: ChatReasoning;
  /** Extra streamText/generateText options (thinking config, etc.). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callOptions: Record<string, any>;
  /**
   * Solo kie: i crediti consumati da questo turno, letti dal corpo delle risposte e AZZERATI a
   * ogni lettura. Assente sugli altri provider. Si legge tramite `takeKieUsage`.
   */
  takeCredits?: () => number;
};

// CREDITI KIE. kie fattura in crediti propri e li mette SOLO nel corpo della risposta
// (`credits_consumed`); l'AI SDK non li espone da nessuna parte e `response.body` è undefined sul
// percorso in streaming. Senza questo tee `provider_credits` resta NULL e il costo verrebbe calcolato
// dai token — che kie riporta come `input_tokens: 0` su ogni step di un loop agentico, cioè «gratis»
// per un turno che è costato davvero. Il tee NON bufferizza: rimette il chunk in coda prima di
// leggerlo, quindi non aggiunge un millisecondo al primo token.
type KieMeter = { credits: number; carry: string };

const CREDITS_RE = /"credits_consumed"\s*:\s*([0-9.]+)/g;

/** Somma ogni `credits_consumed` che passa. `carry` copre la chiave spezzata tra due chunk SSE. */
function scanCredits(meter: KieMeter, chunk: string): void {
  const s = meter.carry + chunk;
  let end = 0;
  CREDITS_RE.lastIndex = 0;
  for (let m = CREDITS_RE.exec(s); m; m = CREDITS_RE.exec(s)) {
    meter.credits += Number(m[1]) || 0;
    end = CREDITS_RE.lastIndex;
  }
  // Si riparte dopo l'ultimo match completo, così nulla viene contato due volte.
  meter.carry = s.slice(Math.max(end, s.length - 48));
}

function kieMeteredFetch(meter: KieMeter): typeof fetch {
  const base = kieFetch();
  return async (url, init) => {
    const res = await base(url, init);
    if (!res.ok || !res.body) return res;
    if (!res.headers.get('content-type')?.includes('text/event-stream')) {
      scanCredits(meter, await res.clone().text());
      return res;
    }
    const dec = new TextDecoder();
    return new Response(
      res.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctrl) {
            ctrl.enqueue(chunk);
            scanCredits(meter, dec.decode(chunk, { stream: true }));
          }
        })
      ),
      { status: res.status, statusText: res.statusText, headers: res.headers }
    );
  };
}

/** Un client kie col suo contatore: un'istanza per turno, quindi un conto per turno. */
function kieClient(baseURL: string) {
  const meter: KieMeter = { credits: 0, carry: '' };
  return {
    client: createOpenAI({ baseURL, apiKey: env.KIE_API_KEY, name: 'kie', fetch: kieMeteredFetch(meter) }),
    takeCredits: () => {
      const c = meter.credits;
      meter.credits = 0;
      return c;
    }
  };
}

/**
 * Riga `ai_calls` per un turno kie: crediti grezzi + il costo che ne deriva, che `logAiCall`
 * preferisce alle RATES.
 *
 * La lettura AZZERA il contatore: un sotto-agente e il turno che lo ha chiamato condividono lo stesso
 * client, quindi chi logga per primo si porta via la sua fetta e il totale delle righe resta uguale
 * al totale speso.
 */
export function takeKieUsage(m: ChatModelResolved): { providerCredits?: number; flatCostUsd?: number } {
  const credits = m.takeCredits?.();
  // 0 crediti = nessuna risposta fatturabile (di norma una chiamata fallita): meglio lasciare che
  // logAiCall ricada sulle RATES che scrivere cost_usd = 0 e far sparire l'errore dai conti.
  if (!credits) return {};
  return { providerCredits: credits, flatCostUsd: Math.round(credits * KIE_CREDIT_USD * 1e6) / 1e6 };
}

/**
 * Ogni turno ha il tetto di output pieno del suo modello: senza, ogni provider applica il proprio
 * default (DeepSeek: 4096) e una risposta lunga torna tagliata a metà frase senza dirlo. Lo spread
 * viene prima, così un call site che sceglie il suo valore vince.
 */
function withOutputCeiling(m: ChatModelResolved): ChatModelResolved {
  return { ...m, callOptions: { maxOutputTokens: maxOutputTokensFor(m.provider, m.modelId), ...m.callOptions } };
}

function deepseekConfigured(): boolean {
  return !!env.DEEPSEEK_API_KEY;
}

function kieConfigured(): boolean {
  return !!env.KIE_API_KEY;
}

function xiaomiConfigured(): boolean {
  return !!env.XIAOMI_MIMO_API_KEY;
}

function geminiConfigured(): boolean {
  return !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
}

/**
 * Il modello della compattazione: MAI quello della conversazione, sempre il più economico che sappia
 * leggere un transcript enorme e riassumerlo. Segue Fast su Luna — la compattazione è tanto input e
 * poco output, cioè dove la differenza di prezzo conta di più. Gemini resta il ripiego senza chiave
 * kie.
 *
 * `null` = non si compatta, deliberatamente: meglio un thread non compattato che pagare in silenzio
 * un modello premium per riassumerlo.
 */
export function compactionModel(): ChatModelResolved | null {
  // 'low': riassumere è un lavoro meccanico, non deve pagare il ragionamento della conversazione.
  if (kieConfigured()) return withOutputCeiling(lunaFast('low', 'fast'));
  if (geminiConfigured()) return geminiFast('low');
  return null;
}

/**
 * Gemini 3.x asks for a LEVEL, not a token budget: `thinkingBudget` is the 2.5-era parameter that
 * `thinkingLevel` replaced, and sending both in one request is a 400. `geminiThinkingLevel` also
 * absorbs the other tiers' vocabularies ('off', 'max', 'xhigh'), which reach this file through the
 * legacy fallback — 3.7 Flash has no off switch, so its floor is 'low'.
 */
function geminiCallOptions(reasoning: ChatReasoning) {
  return {
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: geminiThinkingLevel(reasoning) } }
    }
  };
}

/**
 * SEMPRE Google, mai il passthrough kie. Il trasporto kie (`GEMINI_TRANSPORT=kie`) esiste per il
 * lavoro di sfondo, che nessuno guarda mentre succede; in chat è inutilizzabile — misurato: ~80
 * secondi al primo token contro 5, e 2 delta di streaming invece di 20. Questa funzione non legge
 * `GEMINI_TRANSPORT` apposta: la chat non ha un interruttore da sbagliare.
 */
function googleClient() {
  return createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY });
}

/**
 * Gemini Flash (id da `GEMINI_FLASH`, letto a ogni richiesta): il RIPIEGO che tiene in piedi chat e
 * compattazione quando manca la chiave kie, e lo scambio multimodale per un turno con immagini su un
 * modello che non le legge.
 */
export function geminiFast(
  reasoning: ChatReasoning = DEFAULT_REASONING.fast,
  tier: ChatTier = 'fast'
): ChatModelResolved {
  return withOutputCeiling({
    model: googleClient()(geminiFlash()),
    provider: 'gemini',
    modelId: geminiFlash(),
    tier,
    reasoning,
    callOptions: geminiCallOptions(reasoning)
  });
}

/**
 * DeepSeek OpenAI-compatible chat completions — the DeepSeek V4 Pro custom pick only.
 * DeepSeek defaults to thinking ON at 'high' effort; the injected block is what makes the user's
 * choice stick — the AI SDK has no first-class field for either parameter.
 */
function deepseekChat(
  reasoning: ChatReasoning,
  opts: { modelId: string; tier: ChatTier }
): ChatModelResolved {
  const thinkingBody = deepseekThinking(reasoning);
  const deepseek = createOpenAI({
    baseURL: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    apiKey: env.DEEPSEEK_API_KEY,
    name: 'deepseek',
    fetch: async (url, init) => {
      if (init?.body && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if (body.thinking == null) body.thinking = thinkingBody.thinking;
          if (body.reasoning_effort == null && thinkingBody.reasoning_effort) {
            body.reasoning_effort = thinkingBody.reasoning_effort;
          }
          init = { ...init, body: JSON.stringify(body) };
        } catch {
          /* leave body as-is */
        }
      }
      return fetch(url, init);
    }
  });
  return {
    model: deepseek.chat(opts.modelId),
    provider: 'deepseek',
    modelId: opts.modelId,
    tier: opts.tier,
    reasoning,
    callOptions: {}
  };
}

/** Custom picker: DeepSeek V4 Pro (API id `deepseek-v4-pro`, currently V4-Pro-0813). */
function deepseekPro(reasoning: ChatReasoning = DEFAULT_REASONING['deepseek-pro']): ChatModelResolved {
  return deepseekChat(reasoning, { modelId: DEEPSEEK_PRO_MODEL, tier: 'deepseek-pro' });
}

/**
 * GPT family on kie Codex Responses API (Terra / Sol). Multimodal.
 * Do NOT enable kie web_search — chat already has Exa search_web.
 */
function kieCodex(
  modelId: string,
  tier: ChatTier,
  reasoning: ChatReasoning,
  effort: string
): ChatModelResolved {
  const kie = kieClient(KIE_CODEX_BASE);
  return {
    model: kie.client.responses(modelId),
    provider: 'kie',
    modelId,
    tier,
    reasoning,
    takeCredits: kie.takeCredits,
    callOptions: {
      // I modelli reasoning di kie (Luna/Terra/Sol/Grok) rifiutano `temperature`: i call site della
      // chat la fissano a 0.4 e poi spandono callOptions DOPO, quindi questo undefined la toglie
      // dal filo (l'SDK ignora undefined) e spegne il warning senza toccarla per gli altri modelli.
      temperature: undefined,
      providerOptions: {
        openai: {
          ...KIE_NO_STORE,
          reasoningEffort: effort as unknown as 'low' | 'medium' | 'high',
          // LA CHAT ERA MUTA PER IL 91-95% DEL TURNO. Misurato dall'eval (24/8): prima parola a
          // 7,5s su 8,3s, e a 24,3s su 25,7s. Non era lentezza: era che NON ESISTEVA niente da
          // mostrare prima della `reply` finale. Senza `summary`, la Responses di kie non manda
          // un solo evento di ragionamento — verificato sul filo, stesso prompt:
          //   reasoning:{effort:'high'}                 → 0 eventi reasoning_summary_*
          //   reasoning:{effort:'high',summary:'auto'}  → reasoning_summary_text.delta, e arriva
          //                                               come PRIMO output item, prima del testo
          //                                               e prima della function_call.
          // Il `sendReasoning: true` di live.ts c'era già e non aveva niente da spedire.
          //
          // NON è un preambolo: è il pensiero vero del modello, che la chat collassa sotto
          // «Thought for a moment». Chiedere all'agente di scrivere una riga d'apertura sarebbe
          // stato rimettere il balbettio tolto il 23/8; questo non aggiunge un blocco di testo,
          // riempie un canale che era già cablato e sempre vuoto.
          //
          // Su Grok (`kiePro`) il parametro passa ma non produce niente (provato: zero eventi),
          // quindi non è lì — un'opzione che non fa nulla è solo una riga da leggere a vuoto.
          reasoningSummary: 'auto'
        }
      }
    }
  };
}

/**
 * Pro path: Grok 4.6 via kie.ai Responses API.
 * createOpenAI(...).responses() hits POST {baseURL}/responses — matches kie docs.
 * Do NOT enable kie web_search (mutually exclusive with function tools).
 */
function kiePro(reasoning: ChatReasoning = DEFAULT_REASONING.pro): ChatModelResolved {
  // kieClient monta kieFetch(), che trasforma la busta HTTP-200 `{code:402}` di kie in un errore
  // vero invece di un criptico "output is not iterable" in mezzo alla chat di qualcuno.
  const kie = kieClient('https://api.kie.ai/grok/v1');
  return {
    model: kie.client.responses(KIE_GROK_PRO_MODEL),
    provider: 'kie',
    modelId: KIE_GROK_PRO_MODEL,
    tier: 'pro',
    reasoning,
    takeCredits: kie.takeCredits,
    callOptions: {
      // Stessa ragione di kieCodex: Grok 4.6 è un reasoning model, `temperature` non è supportata.
      temperature: undefined,
      providerOptions: {
        openai: {
            // `KIE_GROK_NO_STORE` = store:false + forceReasoning (vedi kie.ts). Il provider OpenAI
            // dell'AI SDK decide «è un reasoning model?» dal NOME (`o1|o3|o4-mini|gpt-5*`), e
            // `grok-4-6` non è in quella lista: senza `forceReasoning` sparivano dalla richiesta,
            // senza errori, sia `reasoning:{effort}` (il picker del thinking diventava decorativo)
            // sia l'include del reasoning cifrato — cioè il ragionamento dello step N veniva buttato
            // prima dello step N+1, e un modello che pilota 120 strumenti ripartiva dal solo contesto
            // testuale.
          ...KIE_GROK_NO_STORE,
          // Serialized as reasoning:{effort} on the Responses API — kie's documented shape.
          // Cast: 'xhigh' is a Grok level the OpenAI provider's union doesn't know about.
          reasoningEffort: grokReasoningEffort(reasoning) as unknown as 'low' | 'medium' | 'high'
        }
      }
    }
  };
}

/**
 * Fast path: GPT 5.6 Luna sulle Responses di kie Codex. Quello che gira di default in chat.
 * Multimodale (misurato: legge un PNG e ne descrive i quadranti). Niente web_search di kie —
 * è mutuamente esclusiva con i function tool, e la chat ha già Exa.
 */
export function lunaFast(
  reasoning: ChatReasoning = DEFAULT_REASONING.fast,
  tier: ChatTier = 'fast'
): ChatModelResolved {
  return kieCodex(KIE_LUNA_MODEL, tier, reasoning, lunaReasoningEffort(reasoning));
}

/**
 * Guardare una clip è una capacità più stretta che vedere un fotogramma: i provider
 * openai-compatible lanciano `UnsupportedFunctionalityError` invece di degradare.
 */
export function modelSeesVideo(m: ChatModelResolved): boolean {
    // Resta solo Gemini: nessun livello preimpostato guarda più una clip allegata al turno, perché
    // Luna, Grok e i GPT ricevono solo le immagini. Non lo si finge — chi non vede il video non deve
    // riceverne la descrizione.
  return m.provider === 'gemini';
}

export function modelSeesImages(m: ChatModelResolved): boolean {
  if (m.provider === 'gemini') return true;
    // GPT 5.6 Luna / Terra / Sol, e Grok 4.6: kie è multimodale su entrambe le famiglie.
  if (m.provider === 'kie' && /gpt-5|grok/i.test(m.modelId)) return true;
  return false;
}

function legacyFallback(tier: ChatTier, reasoning: ChatReasoning): ChatModelResolved {
  const chatProvider = (env.CHAT_PROVIDER ?? 'gemini').toLowerCase();
  if (chatProvider === 'xiaomi' && xiaomiConfigured()) {
    const xiaomi = createOpenAI({
      baseURL: 'https://api.xiaomimimo.com/v1',
      apiKey: env.XIAOMI_MIMO_API_KEY
    });
    return {
      model: xiaomi.chat(XIAOMI_MODEL),
      provider: 'xiaomi',
      modelId: XIAOMI_MODEL,
      tier,
      reasoning,
      callOptions: {}
    };
  }
  if (geminiConfigured()) return geminiFast(reasoning, tier);
  throw new Error('No chat provider configured (need GEMINI_API_KEY, KIE_API_KEY, or DEEPSEEK_API_KEY)');
}

/** Luna (o Gemini/legacy se manca kie). `tier` resta l'etichetta UI/log (auto|fast|…). */
function resolveLuna(reasoning: ChatReasoning, tier: ChatTier): ChatModelResolved {
  if (kieConfigured()) {
    const label = tier === 'auto' || tier === 'fast' ? tier : 'fast';
    return lunaFast(reasoning, label);
  }
  if (geminiConfigured()) return geminiFast(reasoning, tier);
  return { ...legacyFallback(tier, reasoning), tier };
}

/** Grok via kie; senza chiave, Luna come rete di sicurezza. */
function resolveGrok(reasoning: ChatReasoning, tier: ChatTier): ChatModelResolved {
  if (kieConfigured()) return { ...kiePro(reasoning), tier };
  return resolveLuna(reasoning, tier);
}

/**
 * Quale modello un tier risolve.
 * `family` viene dal catalogo + policy agente (solo su Auto ha effetto diverso dal default tier).
 */
function resolveTier(
  tier: ChatTier,
  reasoning: ChatReasoning,
  familyId: ModelFamilyId
): ChatModelResolved {
  if (tier === 'deepseek-pro' || familyId === 'deepseek-pro') {
    if (deepseekConfigured()) return deepseekPro(reasoning);
    if (kieConfigured()) return { ...kiePro(reasoning), tier: 'deepseek-pro' };
    return legacyFallback('deepseek-pro', reasoning);
  }

  if (tier === 'gpt-terra' || familyId === 'gpt-terra') {
    if (kieConfigured()) {
      return kieCodex(KIE_TERRA_MODEL, 'gpt-terra', reasoning, kieGptReasoningEffort(reasoning));
    }
    return legacyFallback('gpt-terra', reasoning);
  }

  if (tier === 'gpt-sol' || familyId === 'gpt-sol') {
    if (kieConfigured()) {
      return kieCodex(KIE_SOL_MODEL, 'gpt-sol', reasoning, kieGptReasoningEffort(reasoning));
    }
    return legacyFallback('gpt-sol', reasoning);
  }

  if (familyId === 'grok' || tier === 'pro') {
    return resolveGrok(reasoning, tier === 'pro' ? 'pro' : tier);
  }

  return resolveLuna(reasoning, tier === 'auto' || tier === 'fast' ? tier : 'fast');
}

// AUTO → PRO. In Auto il modello lo sceglie l'app, e «produci un video/carosello/UGC» non è una
// domanda: è un incarico, dove la differenza fra i due modelli si vede nel risultato. Classificatore
// DETERMINISTICO (regex it/en, zero chiamate modello). Solo Auto scala: un tier scelto a mano
// dall'utente è una scelta, non un default da correggere.
const HEAVY_VERB_RE =
  /\b(gener(a|are|ami|ate)|generate|crea(re|mi|te)?|create|produc(i|e|urre|iamo)|produce|realizza(re|mi)?|renderizza(re)?|fa(i|mmi)|make|build|prepara(re|mi)?|design|disegna(re|mi)?|scriv(i|ere|imi)|write|lancia(re)?|launch)\b/i;
const HEAVY_NOUN_RE =
  /\b(video|reel(s)?|post(s)?|immagin[ei]|image(s)?|foto|photo(s)?|grafic(a|he)|graphic(s)?|campagn[ae]|campaign(s)?|clip(s)?|spot|avatar|sticker(s)?|articol[oi]|article(s)?|caption(s)?|copertina|thumbnail(s)?)\b/i;
/** Termini che da soli dicono già "produzione pesante" — non servono verbi attorno. */
const HEAVY_ALONE_RE = /\b(motion|ugc|trailer|render|storyboard|carousel(s)?|carosell[oi])\b/i;

/** True quando il messaggio è una richiesta di produzione (post/immagini/video/motion/UGC e simili). */
export function isHeavyProductionAsk(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.slice(0, 4000);
  if (HEAVY_ALONE_RE.test(t)) return true;
  return HEAVY_VERB_RE.test(t) && HEAVY_NOUN_RE.test(t);
}

/**
 * Resolve Fast/Auto/Pro/custom for this turn.
 *
 * @param opts.agentId — specialista (motion, content, …). Su tier Auto decide la famiglia
 *   (motion → Grok; resto → Luna). Su Fast/Pro/custom l'utente ha scelto: l'agente non conta.
 * @param opts.userText — su Auto, richiesta di produzione pesante scala a Pro (Grok high).
 */
export function resolveChatModel(
  rawTier?: unknown,
  rawReasoning?: unknown,
  opts: { userText?: string; agentId?: string | null; model?: unknown } = {}
): ChatModelResolved {
  const envDefault = (env.CHAT_TIER ?? 'fast').toLowerCase();
  let tier: ChatTier = isChatTier(rawTier)
    ? rawTier
    : isChatTier(envDefault)
      ? envDefault
      : DEFAULT_CHAT_TIER;

  // Policy agente: solo Auto la legge. Fast/Pro restano la scelta esplicita dell'utente.
  // La preferenza salvata (thread o agente custom, 0225) sta allo stesso posto e vince sullo spec.
  const saved = turnModelFamily(opts.model);
  const policy = modelPolicyForAgent(opts.agentId);
  const agentFamily: ModelFamilyId | null =
    tier === 'auto' ? (saved?.family ?? policy.family) : null;

  // Una famiglia scelta a mano è una scelta, non un default da correggere: niente scalata.
  if (tier === 'auto' && !saved && kieConfigured() && isHeavyProductionAsk(opts.userText)) tier = 'pro';

  const familyId = familyForTier(tier, agentFamily).id;
  const reasoningRaw =
    rawReasoning === undefined || rawReasoning === null || rawReasoning === ''
      ? tier === 'auto'
        ? (saved?.thinking ?? policy.thinking)
        : undefined
      : rawReasoning;
  const reasoning: ChatReasoning = coerceReasoning(reasoningRaw, tier, agentFamily);

  const resolved = resolveTier(tier, reasoning, familyId);
  return withOutputCeiling(resolved);
}
