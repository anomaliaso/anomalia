// Resolve the LanguageModel for brand chat — every hub agent, peer consults and compaction.
//
// Un tubo solo: ogni scelta attraversa il centralino `llm` (`llmModelForPicker`); il tier resta
// l'etichetta UI/log, la famiglia sceglie solo il thinking. `null` = nessuna scelta: decide il
// default del catalogo (`chat_model_catalog.is_default`).
// Scala thinking comune + mappe native: `src/lib/models/catalog.ts`.
import { maxOutputTokensFor } from '$lib/server/ai-output-limits';
import { env } from '$env/dynamic/private';
import { isGoogleGeminiModel, llmConfigured, llmDefaultModel, llmLanguageModel, llmModelForPicker } from '$lib/server/llm';
import type { LanguageModel } from 'ai';
import { isChatTier, type ChatTier } from '$lib/chat-tiers';
import { coerceReasoning, defaultReasoningFor, type ChatReasoning } from '$lib/chat-reasoning';
import { turnModelFamily } from '$lib/chat-model-policy';

export type ChatModelResolved = {
  model: LanguageModel;
  provider: 'deepseek' | 'kie' | 'xiaomi' | 'gemini' | 'openrouter' | 'opencode' | 'llm';
  modelId: string;
  tier: ChatTier | null;
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
  reasoning: ChatReasoning = defaultReasoningFor(null),
  tier: ChatTier | null = null
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

/**
 * True quando il messaggio è una richiesta di produzione (post/immagini/video/motion/UGC e simili).
 *
 * Ha UN solo consumatore, `forcedFirstStepTools`, e su un "sì" quel consumatore OBBLIGA il modello
 * a chiamare un tool al primo step. Quindi la domanda vera non è «parla di produzione?» ma
 * «possiamo costringerlo a produrre?».
 *
 * Ed è per questo che la negazione conta. «Non fare alcun post» ha le stesse parole di «fai un
 * post», e senza guardarla l'agente generava un'immagine mentre l'utente gli diceva di non farne
 * nessuna — non ignorando l'istruzione, ma perché gliela facevamo ignorare noi.
 *
 * I due errori non costano uguale, ed è questo che decide la regola: non forzare quando avremmo
 * potuto lascia il modello libero di chiamare il tool lo stesso; forzare quando l'utente ha detto
 * di no scavalca un'istruzione esplicita. Nel dubbio non si forza — quindi basta una negazione in
 * qualunque punto del messaggio, senza provare a capire su cosa cade.
 *
 * Classificatore DETERMINISTICO (regex it/en, zero chiamate modello).
 */
const HEAVY_VERB_RE =
  /\b(gener(a|are|ami|ate)|generate|crea(re|mi|te)?|create|produc(i|e|urre|iamo)|produce|realizza(re|mi)?|renderizza(re)?|fa(i|mmi)|make|build|prepara(re|mi)?|design|disegna(re|mi)?|scriv(i|ere|imi)|write|lancia(re)?|launch)\b/i;
const HEAVY_NOUN_RE =
  /\b(video|reel(s)?|post(s)?|immagin[ei]|image(s)?|foto|photo(s)?|grafic(a|he)|graphic(s)?|campagn[ae]|campaign(s)?|clip(s)?|spot|avatar|sticker(s)?|articol[oi]|article(s)?|caption(s)?|copertina|thumbnail(s)?)\b/i;
/** Termini che da soli dicono già "produzione pesante" — non servono verbi attorno. */
const HEAVY_ALONE_RE = /\b(motion|ugc|trailer|render|storyboard|carousel(s)?|carosell[oi])\b/i;

const NEGATION_RE =
  /\b(non|senza|evita(re|ndo)?|niente|nessun[aeio]?|mai|no(n)?\s+voglio|don'?t|do\s+not|without|avoid(ing)?|never|no\s+need)\b/i;

export function isHeavyProductionAsk(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.slice(0, 4000);
  if (NEGATION_RE.test(t)) return false;
  if (HEAVY_ALONE_RE.test(t)) return true;
  return HEAVY_VERB_RE.test(t) && HEAVY_NOUN_RE.test(t);
}

/**
 * Il modello di questo turno.
 *
 * Una sola scaletta, e nessun preset dentro: la scelta esplicita del turno, altrimenti quella
 * salvata sul thread o sull'agente custom, altrimenti il default globale del catalogo. Chi non
 * sceglie non "cade su Auto": prende la riga che l'operatore ha marcato in Supabase.
 */
export function resolveChatModel(
  rawTier?: unknown,
  rawReasoning?: unknown,
  opts: { agentId?: string | null; model?: unknown } = {}
): ChatModelResolved {
  const saved = turnModelFamily(opts.model);
  const tier: ChatTier | null = isChatTier(rawTier) ? rawTier : (saved?.model ?? null);

  const reasoningRaw =
    rawReasoning === undefined || rawReasoning === null || rawReasoning === ''
      ? saved?.thinking
      : rawReasoning;
  const reasoning: ChatReasoning = coerceReasoning(reasoningRaw, tier);

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
