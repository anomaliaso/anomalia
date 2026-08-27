/**
 * Il registro: un vocabolario solo per dire chi serve quale lavoro, al posto di cinque interruttori
 * che non sapevano l'uno dell'altro né **cosa il provider scelto sa fare** — spostare un lavoro
 * poteva togliergli in silenzio il grounding, gli embedding o i fps di un video, e il guasto
 * arrivava come una risposta plausibile invece che come un errore.
 *
 * Due assi, che non si collassano mai in uno:
 *   · famiglia — QUALE modello scrive. È la garanzia di qualità: `PIN_GEMINI` in 28 call site vuol
 *     dire "questo lavoro lo fa Gemini", e non deve mai diventare un interruttore di trasporto.
 *   · endpoint — CHI lo serve e chi ci fattura. Gemini lo servono sia Google sia kie.
 * `AI_ROUTE_TEXT=gemini@kie` = famiglia Gemini, servita da kie. Senza `@`, l'endpoint di casa.
 *
 * PREZZI: nessuno qui, di proposito — stanno in `RATES` dentro `ai-log.ts` e ci arrivano per
 * `ai_calls.model`. Il registro dice solo sotto quale `provider` va scritta la riga.
 */
import { env } from '$env/dynamic/private';

/** La famiglia di modelli: cosa scrive/disegna, indipendentemente da chi la serve. */
export type ModelFamily = 'gemini' | 'mimo' | 'grok' | 'gpt' | 'deepseek' | 'nano-banana' | 'gemini-tts';

/** L'endpoint: chi serve la famiglia e chi ci manda il conto. */
export type Endpoint = 'google' | 'kie' | 'xiaomi' | 'deepseek';

/** Il valore che finisce in `ai_calls.provider`. Uno per endpoint, non uno per famiglia. */
export type LogProvider = 'gemini' | 'kie' | 'xiaomi' | 'deepseek';

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
  | 'music';

const ALL: Capability[] = [
  'structured', 'tools', 'image-in', 'video-in', 'audio-in', 'grounding', 'thinking-level',
  'media-in-tool-result', 'video-fps', 'prompt-cache', 'fast-first-token', 'embeddings', 'music'
];

/**
 * Cosa NON sa fare ogni endpoint. Le assenze e non le presenze, di proposito: un endpoint nuovo
 * parte capace di tutto e si scopre incapace un guasto alla volta.
 */
const MISSING: Record<Endpoint, Partial<Record<Capability, string>>> = {
  google: {},
  kie: {
    grounding: 'kie non restituisce groundingMetadata: le citazioni tornano vuote',
    'media-in-tool-result': 'kie scarta i media dentro i risultati dei tool, in silenzio',
    'video-fps': 'kie ignora videoMetadata.fps (388 token di prompt contro 1627)',
    'prompt-cache': 'kie non ha il tier di cache: i token ripetuti costano pieni, e più che su Google',
    'fast-first-token': 'kie impiega ~80s al primo token in streaming',
    embeddings: 'kie non serve embedContent',
    music: 'kie non serve Lyria'
  },
  xiaomi: {
    // `mimo-v2.5-pro` rifiuta le immagini: solo il tier base le accetta, per questo
    // `structuredXiaomi` cambia modello da solo quando ne arrivano.
    'video-in': 'MiMo non accetta video in ingresso',
    'audio-in': 'MiMo non accetta audio in ingresso',
    grounding: 'MiMo ha una sua web search, non il grounding Google con citazioni',
    'thinking-level': 'MiMo non espone un livello di ragionamento',
    'media-in-tool-result': 'MiMo non accetta media nei risultati dei tool',
    'video-fps': 'MiMo non legge video',
    embeddings: 'MiMo non serve embedding',
    music: 'MiMo non genera musica'
  },
  deepseek: {
    'image-in': 'la API DeepSeek rifiuta l\'input immagine',
    'video-in': 'DeepSeek non legge video',
    'audio-in': 'DeepSeek non legge audio',
    grounding: 'DeepSeek fa web search a modello, non grounding Google con citazioni',
    'media-in-tool-result': 'DeepSeek non accetta media nei risultati dei tool',
    'video-fps': 'DeepSeek non legge video',
    'thinking-level': 'DeepSeek prende un blocco thinking iniettato, non un livello',
    embeddings: 'DeepSeek non è configurato per gli embedding qui',
    music: 'DeepSeek non genera musica'
  }
};

/** L'endpoint di casa di ogni famiglia: quello che serve quando nessuno scrive `@`. */
const HOME: Record<ModelFamily, Endpoint> = {
  gemini: 'google',
  'gemini-tts': 'google',
  'nano-banana': 'google',
  mimo: 'xiaomi',
  grok: 'kie',
  gpt: 'kie',
  deepseek: 'deepseek'
};

/** Quale riga di `ai_calls.provider` scrive ogni endpoint. */
const LOG_PROVIDER: Record<Endpoint, LogProvider> = {
  google: 'gemini',
  kie: 'kie',
  xiaomi: 'xiaomi',
  deepseek: 'deepseek'
};

/** La chiave che ogni endpoint pretende. Senza, l'instradamento non ci prova nemmeno. */
function endpointConfigured(endpoint: Endpoint): boolean {
  switch (endpoint) {
    case 'google': return !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
    case 'kie': return !!env.KIE_API_KEY;
    case 'xiaomi': return !!env.XIAOMI_MIMO_API_KEY;
    case 'deepseek': return !!env.DEEPSEEK_API_KEY;
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
export type Slot = 'text' | 'image' | 'tts';

const SLOT_DEFAULT: Record<Slot, Route> = {
  // Il lavoro di sfondo resta su Gemini servito da Google, come oggi.
  text: r('gemini', 'google'),
  // Nano Banana Pro/2 girano su kie: stesso modello, −33% e −40% per immagine (misurato sui
  // crediti addebitati). Senza chiave kie si torna su Google da soli.
  image: r('nano-banana', 'kie'),
  // La voce su kie COSTA DI PIÙ (~3× a parità di battuta): lo scopo è togliere una dipendenza
  // dalla API di Google, non risparmiare. Chi legge dopo darà per scontato il contrario.
  tts: r('gemini-tts', 'kie')
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
      // GTM_PROVIDER sceglieva la FAMIGLIA (gemini|xiaomi|kie) e GEMINI_TRANSPORT l'ENDPOINT della
      // sola famiglia Gemini: erano già i due assi, scritti come se fossero scollegati.
      const gtm = env.GTM_PROVIDER?.trim().toLowerCase();
      if (gtm === 'xiaomi') return r('mimo', 'xiaomi');
      if (gtm === 'kie') return r('grok', 'kie');
      if (env.GEMINI_TRANSPORT?.trim().toLowerCase() === 'kie') return r('gemini', 'kie');
      return null;
    }
    case 'image':
      return env.IMAGE_PROVIDER?.trim().toLowerCase() === 'gemini' ? r('nano-banana', 'google') : null;
    case 'tts':
      return env.TTS_PROVIDER?.trim().toLowerCase() === 'gemini' ? r('gemini-tts', 'google') : null;
  }
}

const SLOT_ENV: Record<Slot, string> = {
  text: 'AI_ROUTE_TEXT',
  image: 'AI_ROUTE_IMAGE',
  tts: 'AI_ROUTE_TTS'
};

/**
 * Dove va questo lavoro, adesso. Letto A OGNI CHIAMATA come `GEMINI_FLASH`: cambiare una variabile
 * su Vercel deve bastare a spostare il traffico, senza deploy, mentre il guasto è in corso.
 *
 * Un endpoint senza chiave non è una rotta, è un 401 con più passaggi: si ripiega sull'endpoint di
 * casa della famiglia, e se manca anche quello su Google. Il ripiego è RUMOROSO.
 */
export function route(slot: Slot): Route {
  const chosen = parseRoute(env[SLOT_ENV[slot]]) ?? legacyRoute(slot) ?? SLOT_DEFAULT[slot];
  if (endpointConfigured(chosen.endpoint)) return chosen;
  const home = HOME[chosen.family];
  const fallback = endpointConfigured(home) ? home : 'google';
  console.warn(
    `[AI] ${SLOT_ENV[slot]} chiede ${chosen.family}@${chosen.endpoint} ma la chiave manca: ripiego su ${fallback}.`
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

// Il video non ha due assi: Seedance e Grok Imagine sono ENTRAMBI modelli di kie, quindi la scelta
// è solo l'id del modello. Le variabili hanno la stessa forma degli altri slot solo per
// vocabolario, non perché il meccanismo sia lo stesso.

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
