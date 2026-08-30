// Resolve the LanguageModel for brand chat — every hub agent, peer consults and compaction.
//
// Un tubo solo: ogni tier (Fast/Auto/Pro/custom) attraversa il centralino `llm`
// (`llmModelForPicker`); il tier resta l'etichetta UI/log, la famiglia sceglie solo il thinking.
// Scala thinking comune + mappe native: `src/lib/models/catalog.ts`.
import { maxOutputTokensFor } from '$lib/server/ai-output-limits';
import { env } from '$env/dynamic/private';
import { isGoogleGeminiModel, llmConfigured, llmDefaultModel, llmLanguageModel, llmModelForPicker } from '$lib/server/llm';
import type { LanguageModel } from 'ai';
import { DEFAULT_CHAT_TIER, isChatTier, type ChatTier } from '$lib/chat-tiers';
import { DEFAULT_REASONING, coerceReasoning, type ChatReasoning } from '$lib/chat-reasoning';
import { familyForTier, type ModelFamilyId } from '$lib/models/catalog';
import { modelPolicyForAgent } from '$lib/agent/specs';
import { turnModelFamily } from '$lib/chat-model-policy';

export type ChatModelResolved = {
  model: LanguageModel;
  provider: 'deepseek' | 'kie' | 'xiaomi' | 'gemini' | 'openrouter' | 'opencode' | 'llm';
  modelId: string;
  tier: ChatTier;
  /** Effort actually requested — logged so a slow turn can be explained after the fact. */
  reasoning: ChatReasoning;
  /** Extra streamText/generateText options (thinking config, etc.). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callOptions: Record<string, any>;
};

/**
 * Ogni turno ha il tetto di output pieno del suo modello: senza, ogni provider applica il proprio
 * default (DeepSeek: 4096) e una risposta lunga torna tagliata a metà frase senza dirlo. Lo spread
 * viene prima, così un call site che sceglie il suo valore vince.
 */
function withOutputCeiling(m: ChatModelResolved): ChatModelResolved {
  return { ...m, callOptions: { maxOutputTokens: maxOutputTokensFor(m.provider, m.modelId), ...m.callOptions } };
}

/**
 * Il modello della compattazione: MAI quello della conversazione, sempre il più economico che sappia
 * leggere un transcript enorme e riassumerlo. Segue Fast sul centralino — la compattazione è tanto
 * input e poco output, cioè dove la differenza di prezzo conta di più.
 *
 * `null` = non si compatta, deliberatamente: meglio un thread non compattato che pagare in silenzio
 * un modello premium per riassumerlo.
 */
export function compactionModel(): ChatModelResolved | null {
  // 'low': riassumere è un lavoro meccanico, non deve pagare il ragionamento della conversazione.
  if (llmConfigured()) return geminiFast('low');
  return null;
}

/**
 * Modello di default sul centralino.
 */
export function geminiFast(
  reasoning: ChatReasoning = DEFAULT_REASONING.fast,
  tier: ChatTier = 'fast'
): ChatModelResolved {
  const modelId = llmDefaultModel();
  return withOutputCeiling({
    model: llmLanguageModel(modelId),
    provider: 'llm',
    modelId,
    tier,
    reasoning,
    callOptions: {}
  });
}

/**
 * Guardare una clip è una capacità più stretta che vedere un fotogramma: i provider
 * openai-compatible lanciano `UnsupportedFunctionalityError` invece di degradare.
 */
export function modelSeesVideo(m: ChatModelResolved): boolean {
  return m.provider === 'llm' && isGoogleGeminiModel(m.modelId);
}

export function modelSeesImages(m: ChatModelResolved): boolean {
  if (m.provider === 'llm' || m.provider === 'gemini') return true;
  if (m.provider === 'kie' && /gpt-5|grok/i.test(m.modelId)) return true;
  return false;
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
 *   del thinking. Su Fast/Pro/custom l'utente ha scelto: l'agente non conta.
 * @param opts.userText — su Auto, richiesta di produzione pesante scala a Pro.
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
  // Il centralino ha sempre un modello "pro" secondo della lista: il Pro è il secondo modello
  // della lista del picker, un brand solo-gateway scala comunque su un incarico pesante.
  if (tier === 'auto' && !saved && isHeavyProductionAsk(opts.userText)) tier = 'pro';

  const familyId = familyForTier(tier, agentFamily).id;
  const reasoningRaw =
    rawReasoning === undefined || rawReasoning === null || rawReasoning === ''
      ? tier === 'auto'
        ? (saved?.thinking ?? policy.thinking)
        : undefined
      : rawReasoning;
  const reasoning: ChatReasoning = coerceReasoning(reasoningRaw, tier, agentFamily);

  const modelId = llmModelForPicker(tier);
  const resolved: ChatModelResolved = {
    model: llmLanguageModel(modelId),
    provider: 'llm',
    modelId,
    tier,
    reasoning,
    callOptions: {}
  };
  return withOutputCeiling(resolved);
}
