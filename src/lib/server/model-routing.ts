/**
 * Il registro: un vocabolario solo per dire chi serve quale lavoro, al posto di cinque interruttori
 * che non sapevano l'uno dell'altro né **cosa il provider scelto sa fare** — spostare un lavoro
 * poteva togliergli in silenzio il grounding, gli embedding o i fps di un video, e il guasto
 * arrivava come una risposta plausibile invece che come un errore.
 *
 * Restano DUE trasporti: **openrouter serve, kie ripiega.** Google, Xiaomi e DeepSeek sono usciti —
 * non per prezzo, ma perché su questo non ci si fonda: kie fallisce il 3,5% dei render con un p95
 * di 142,9s contro i 3,4s di OpenRouter, e DeepSeek falliva il 41,3% di 5.122 chiamate. kie resta
 * come RIPIEGO — un secondo trasporto vale più di zero — non perché sappia fare qualcosa che
 * OpenRouter non sa: l'ultima cosa in quell'elenco era il TTS, e non era vera.
 *
 * Due assi, che non si collassano mai in uno:
 *   · famiglia — QUALE modello scrive. È la garanzia di qualità, e non deve mai diventare un
 *     interruttore di trasporto.
 *   · endpoint — CHI lo serve e chi ci fattura. Gemini lo servono sia openrouter sia kie, e
 *     `PIN_GATEWAY` fissa QUESTO asse: "questo lavoro lo serve il gateway", e niente sulla
 *     famiglia. Si chiamava `PIN_GEMINI`, cioè nominava l'asse sbagliato: il collasso dei due
 *     assi comincia da un nome così, prima che da una riga di codice.
 * `AI_ROUTE_TEXT=gemini@kie` = famiglia Gemini, servita da kie. Senza `@`, l'endpoint di casa.
 *
 * Le tabelle sono allineate apposta: aggiungere o togliere un endpoint è UNA RIGA per tabella, e
 * `SERVED_BY` dice quali coppie hanno davvero un trasporto scritto. Una coppia che non ce l'ha non
 * è una rotta: si rifiuta rumorosamente invece di atterrare altrove facendo credere di essere stata
 * rispettata. Vale anche per le vecchie variabili che nominano un endpoint rimosso (`RETIRED_LEGACY`).
 *
 * PREZZI: nessuno qui, di proposito. Il costo lo dice chi ce lo fattura — `usage.cost` su
 * openrouter, `credits_consumed` su kie. Il registro dice solo sotto quale `provider` va scritta
 * la riga di `ai_calls`.
 */
import { env } from '$env/dynamic/private';

/**
 * La famiglia di modelli: cosa scrive/disegna/gira, indipendentemente da chi la serve.
 *
 * Una famiglia per (fornitore, modalità), mai una sola per fornitore: `gemini` e `gemini-tts` sono
 * già due, e `grok` (testo) e `grok-imagine` (video) restano due per la stessa ragione. Collassarle
 * renderebbe `SERVED_BY` una bugia — collegare il trasporto video di Grok aprirebbe in silenzio la
 * rotta del suo testo verso un endpoint che quel testo non serve.
 */
export type ModelFamily =
  | 'gemini'
  | 'grok'
  | 'gpt'
  | 'nano-banana'
  | 'gemini-tts'
  | 'grok-imagine'
  | 'seedance'
  | 'kling';

/** L'endpoint: chi serve la famiglia e chi ci manda il conto. */
export type Endpoint = 'kie' | 'openrouter';

/** Il valore che finisce in `ai_calls.provider`. Uno per endpoint, non uno per famiglia. */
export type LogProvider = 'kie' | 'openrouter';

/** Fatti MISURATI, non ipotesi di listino: ogni assenza qui sotto è una regressione vista. */
export type Capability =
  /** Schema vincolato lato server (responseSchema / json_schema). */
  | 'structured'
  /** Function calling. */
  | 'tools'
  /** Immagini in ingresso. */
  | 'image-in'
  /** Video in ingresso. */
  | 'video-in'
  /** Audio in ingresso (trascrizione, sottotitoli). */
  | 'audio-in'
  /** Grounding Google con `groundingMetadata` — cioè con le CITAZIONI, non solo con la prosa. */
  | 'grounding'
  /** `thinkingLevel` onorato. */
  | 'thinking-level'
  /** Media allegati dentro il RISULTATO di un tool. */
  | 'media-in-tool-result'
  /** `videoMetadata.fps` onorato. */
  | 'video-fps'
  /** Tier di prompt cache scontato sull'input ripetuto. */
  | 'prompt-cache'
  /** Primo token in pochi secondi: l'unica soglia che conta in chat. */
  | 'fast-first-token'
  /** `embedContent`. */
  | 'embeddings'
  /** Generazione musicale (Lyria). */
  | 'music'
  /** Sintesi vocale: testo → parlato, con una voce scelta. NON è "un modello audio". */
  | 'tts';

const ALL: Capability[] = [
  'structured', 'tools', 'image-in', 'video-in', 'audio-in', 'grounding', 'thinking-level',
  'media-in-tool-result', 'video-fps', 'prompt-cache', 'fast-first-token', 'embeddings', 'music', 'tts'
];

/**
 * Cosa NON sa fare ogni endpoint. Le assenze e non le presenze, di proposito: un endpoint nuovo
 * parte capace di tutto e si scopre incapace un guasto alla volta.
 */
const MISSING: Record<Endpoint, Partial<Record<Capability, string>>> = {
  // Vuoto, e ci è voluto sbagliare due volte per arrivarci: qui c'era scritto che OpenRouter non
  // fa sintesi vocale. Era falso. `POST /audio/speech` con `google/gemini-3.1-flash-tts-preview`
  // risponde 200 e `content-type: audio/pcm;rate=24000;channels=1` — la forma esatta che il
  // tagliatore vuole. Cercarla su `chat/completions` (dove risponde solo `gpt-audio`, e solo in
  // streaming) e cercarla su `/audio/speech` con id inventati sono due modi di non trovarla.
  openrouter: {},
  kie: {
    grounding: 'kie non restituisce groundingMetadata: le citazioni tornano vuote',
    'media-in-tool-result': 'kie scarta i media dentro i risultati dei tool, in silenzio',
    'video-fps': 'kie ignora videoMetadata.fps (388 token di prompt contro 1627)',
    'prompt-cache': 'kie non ha il tier di cache: i token ripetuti costano pieni, e più che su Google',
    'fast-first-token': 'kie impiega ~80s al primo token in streaming',
    embeddings: 'kie non serve embedContent',
    music: 'kie non serve Lyria'
  }
};

/**
 * L'endpoint di casa di ogni famiglia: quello che serve quando nessuno scrive `@`, ed è anche il
 * bersaglio del RIPIEGO quando la rotta scelta non è servibile.
 *
 * Per `nano-banana` è kie e NON openrouter, che pure è il default dello slot: sono due ruoli
 * diversi. Il default dice dove va il traffico quando tutto funziona; questa riga dice dove va
 * quando openrouter non è utilizzabile — e lì la risposta è kie, non Google. Farle coincidere
 * mandava il ripiego su Google saltando kie del tutto, che è l'opposto di «kie resta il ripiego».
 */
const HOME: Record<ModelFamily, Endpoint> = {
  gemini: 'kie',
  // Come `nano-banana` e `grok-imagine`: openrouter è il DEFAULT dello slot, kie è dove si ripiega.
  'gemini-tts': 'kie',
  'nano-banana': 'kie',
  grok: 'kie',
  gpt: 'kie',
  'grok-imagine': 'kie',
  seedance: 'kie',
  kling: 'kie'
};

/**
 * Chi ha un TRASPORTO scritto per quella famiglia. Non è una capacità del provider: è codice che
 * esiste o non esiste da noi. `gemini@openrouter` si analizza benissimo, ma `geminiTransport()`
 * conosce solo kie e google — quella rotta atterrerebbe su Google IN SILENZIO, cioè si leggerebbe
 * come rispettata senza esserlo, che è il guasto peggiore di tutti perché non lascia traccia.
 *
 * Sta qui e non in tre file perché una regola scritta in tre posti diverge al primo cambiamento.
 * Il giorno che si collega un trasporto nuovo, si aggiunge un endpoint a una riga di questa tabella
 * e basta.
 */
const SERVED_BY: Record<ModelFamily, Endpoint[]> = {
  gemini: ['kie', 'openrouter'],
  'gemini-tts': ['kie', 'openrouter'],
  'nano-banana': ['kie', 'openrouter'],
  grok: ['kie'],
  gpt: ['kie'],
  'grok-imagine': ['kie', 'openrouter'],
  seedance: ['kie', 'openrouter'],
  kling: ['kie', 'openrouter']
};

/** Quale riga di `ai_calls.provider` scrive ogni endpoint. */
const LOG_PROVIDER: Record<Endpoint, LogProvider> = {
  openrouter: 'openrouter',
  kie: 'kie'
};

/** La chiave che ogni endpoint pretende. Senza, l'instradamento non ci prova nemmeno. */
function endpointConfigured(endpoint: Endpoint): boolean {
  switch (endpoint) {
    case 'kie': return !!env.KIE_API_KEY;
    case 'openrouter': return !!(env.OPENROUTER_API_KEY || env.LLM_API_KEY);
  }
}

export type Route = { family: ModelFamily; endpoint: Endpoint; provider: LogProvider };

/**
 * Gli slot sono il LAVORO, non il modello: chi chiama chiede "il testo di sfondo", non "Gemini
 * Flash", per questo lo slot cambia provider senza che nessun call site lo sappia.
 *
 * La chat NON è uno slot, di proposito: misurata inutilizzabile su kie (~80s al primo token), e
 * `chat/model.ts` non deve avere un interruttore da sbagliare.
 */
export type Slot = 'text' | 'image' | 'tts' | 'video';

const SLOT_DEFAULT: Record<Slot, Route> = {
  // Il testo su OpenRouter: `structuredGemini` e `groundedGemini` ci passavano gia` da `llm.ts`,
  // e il carico su Google si era fermato da solo il 30 agosto. Qui il default dice la verita`.
  text: r('gemini', 'openrouter'),
  // Non il prezzo: kie fallisce il 3,5% dei render con un p95 di 142,9s contro i 3,4s di OpenRouter.
  image: r('nano-banana', 'openrouter'),
  // Stessa famiglia Gemini servita da openrouter: le voci sono le stesse (Kore, Puck, Charon,
  // Aoede, Fenrir tutte accettate), quindi per il cliente non cambia nulla. Il costo nemmeno —
  // stesso copione, kie 1,19 crediti = $0,00595 contro $0,005772. Cambia il ripiego, che ora c'e'.
  tts: r('gemini-tts', 'openrouter'),
  // Il video resta dov'è, e OpenRouter costa 6× kie su Grok Imagine (misurato): spostarlo e` una
  // decisione esplicita, non un effetto dell'uniformita'. La famiglia qui e` la LINEA DI DEFAULT,
  // non il modello del render — quello lo scelgono le preferenze del brand (`videoModelForRole`) e
  // `videoModel(job)`. Del video slot il trasporto legge l'ENDPOINT.
  video: r('grok-imagine', 'kie')
};

function r(family: ModelFamily, endpoint: Endpoint): Route {
  return { family, endpoint, provider: LOG_PROVIDER[endpoint] };
}

const FAMILIES = Object.keys(HOME) as ModelFamily[];
const ENDPOINTS = Object.keys(LOG_PROVIDER) as Endpoint[];

/** `gemini@kie` → {gemini, kie}. Un valore che non si capisce vale null: si torna al default. */
export function parseRoute(raw: string | undefined | null): Route | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  const [f, e] = v.split('@');
  const family = FAMILIES.find((x) => x === f);
  if (!family) {
    console.warn(`[AI] rotta sconosciuta "${raw}": famiglie valide ${FAMILIES.join(' | ')}`);
    return null;
  }
  if (!e) return r(family, HOME[family]);
  const endpoint = ENDPOINTS.find((x) => x === e);
  if (!endpoint) {
    console.warn(`[AI] endpoint sconosciuto "${e}" in "${raw}": validi ${ENDPOINTS.join(' | ')}`);
    return null;
  }
  return r(family, endpoint);
}

/**
 * Le vecchie variabili, tradotte nel nuovo vocabolario. Restano vive perché sono già scritte nella
 * configurazione di produzione e spegnerle in un deploy è il modo di scoprire, di domenica, che
 * l'interruttore di emergenza non c'è più. La nuova `AI_ROUTE_*` VINCE quando è presente.
 */
function legacyRoute(slot: Slot): Route | null {
  switch (slot) {
    case 'text': {
      // GTM_PROVIDER=kie e GEMINI_TRANSPORT=kie restano onorate: kie e` ancora un endpoint.
      if (env.GTM_PROVIDER?.trim().toLowerCase() === 'kie') return r('grok', 'kie');
      if (env.GEMINI_TRANSPORT?.trim().toLowerCase() === 'kie') return r('gemini', 'kie');
      return null;
    }
    case 'image':
    case 'tts':
      return null;
    // Il video non ha mai avuto una variabile di TRASPORTO: `KIE_VIDEO_MODEL_*` sceglieva l'id del
    // modello, e continua a farlo in `videoModel(job)`.
    case 'video':
      return null;
  }
}

/**
 * I valori delle vecchie variabili che nominavano un endpoint ORA RIMOSSO. Accettarne uno in
 * silenzio manderebbe il traffico altrove lasciando credere che la rotta sia stata rispettata: e`
 * lo stesso guasto di una coppia senza trasporto, e si tratta allo stesso modo — si avvisa e si
 * ignora, e decide il default.
 */
const RETIRED_LEGACY: Array<[name: string, value: string]> = [
  ['GTM_PROVIDER', 'xiaomi'],
  ['GEMINI_TRANSPORT', 'google'],
  ['IMAGE_PROVIDER', 'gemini'],
  ['TTS_PROVIDER', 'gemini'],
  ['AI_PROVIDER', 'xiaomi']
];

function warnRetiredLegacy(): void {
  for (const [name, dead] of RETIRED_LEGACY) {
    if (env[name]?.trim().toLowerCase() !== dead) continue;
    console.warn(
      `[AI] ${name}=${dead} nomina un endpoint rimosso: ignorata. Restano kie e openrouter, e si scelgono con AI_ROUTE_*.`
    );
  }
}

const SLOT_ENV: Record<Slot, string> = {
  text: 'AI_ROUTE_TEXT',
  image: 'AI_ROUTE_IMAGE',
  tts: 'AI_ROUTE_TTS',
  video: 'AI_ROUTE_VIDEO'
};

/**
 * Dove va questo lavoro, adesso. Letto A OGNI CHIAMATA come `GEMINI_FLASH`: cambiare una variabile
 * su Vercel deve bastare a spostare il traffico, senza deploy, mentre il guasto è in corso.
 *
 * Due modi di non essere una rotta, e nessuno dei due atterra in silenzio: un endpoint senza chiave
 * è un 401 con più passaggi, una coppia senza trasporto è peggio — la rotta si legge come rispettata
 * e serve un altro provider. Si ripiega sull'endpoint di casa della famiglia, e se manca anche
 * quello su Google. Il ripiego è RUMOROSO, e dice QUALE dei due motivi.
 */
function unroutable(chosen: Route): string | null {
  if (!SERVED_BY[chosen.family].includes(chosen.endpoint)) {
    return `nessun trasporto ${chosen.family} verso ${chosen.endpoint}`;
  }
  return endpointConfigured(chosen.endpoint) ? null : 'la chiave manca';
}

export function route(slot: Slot): Route {
  warnRetiredLegacy();
  const chosen = parseRoute(env[SLOT_ENV[slot]]) ?? legacyRoute(slot) ?? SLOT_DEFAULT[slot];
  const why = unroutable(chosen);
  if (!why) return chosen;
  const home = HOME[chosen.family];
  const fallback = unroutable(r(chosen.family, home)) ? 'kie' : home;
  console.warn(
    `[AI] ${SLOT_ENV[slot]} chiede ${chosen.family}@${chosen.endpoint}: ${why}. Ripiego su ${fallback}.`
  );
  return r(chosen.family, fallback);
}

/** True quando quell'endpoint sa fare quella cosa. */
export function can(endpoint: Endpoint, cap: Capability): boolean {
  return !(cap in MISSING[endpoint]);
}

/** Tutto quello che un endpoint NON sa fare, con il perché misurato accanto. */
export function missingCapabilities(endpoint: Endpoint): Capability[] {
  return ALL.filter((c) => !can(endpoint, c));
}

/**
 * La rotta dello slot, ma solo se sa fare ciò che serve — altrimenti si ferma QUI, col nome della
 * variabile da cambiare. È il punto dell'intero registro: una chiamata lasciata passare verso un
 * provider incapace non dà un errore, dà una risposta plausibile senza citazioni. Meglio
 * un'eccezione nei log che un mese di risultati sbagliati.
 */
export function requireCapabilities(slot: Slot, caps: Capability[]): Route {
  const chosen = route(slot);
  const missing = caps.filter((c) => !can(chosen.endpoint, c));
  if (missing.length) {
    throw new Error(
      `${SLOT_ENV[slot]}=${chosen.family}@${chosen.endpoint} non può servire questa chiamata: ` +
        missing.map((c) => `${c} (${MISSING[chosen.endpoint][c]})`).join('; ')
    );
  }
  return chosen;
}

// L'id del modello per ciascun mestiere video. È l'asse della FAMIGLIA sceso al modello singolo:
// `AI_ROUTE_VIDEO` dice chi serve il render, queste variabili dicono quale modello gira.

export type VideoJob = 'i2v' | 't2v' | 'upscale';

const VIDEO_DEFAULT: Record<VideoJob, string> = {
  i2v: 'grok-imagine-video-1-5-preview',
  t2v: 'grok-imagine/text-to-video',
  // Prende il task_id del job ORIGINALE, mai un URL: per questo l'id resta salvato sul post.
  upscale: 'grok-imagine/upscale'
};

const VIDEO_ENV: Record<VideoJob, [now: string, legacy: string]> = {
  i2v: ['AI_ROUTE_VIDEO_I2V', 'KIE_VIDEO_MODEL_I2V'],
  t2v: ['AI_ROUTE_VIDEO_T2V', 'KIE_VIDEO_MODEL_T2V'],
  upscale: ['AI_ROUTE_VIDEO_UPSCALE', 'KIE_VIDEO_MODEL_UPSCALE']
};

/** L'id del modello video per questo lavoro. I tetti di durata NON stanno qui: `videoModelCaps`. */
export function videoModel(job: VideoJob): string {
  const [now, legacy] = VIDEO_ENV[job];
  return env[now]?.trim() || env[legacy]?.trim() || VIDEO_DEFAULT[job];
}
