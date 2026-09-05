/**
 * I modelli che possono girare un video per un brand, e COSA ciascuno sa fare.
 *
 * Stessa forma del registro immagini (`image-models.ts`) e per la stessa ragione: le differenze
 * fra provider erano una catena di `if` in `videoModelCaps`, dove l'ordine dei rami decideva il
 * risultato — `seedance-2-5` doveva essere valutato PRIMA di `seedance-2`, che lo prefissa, o
 * ereditava il tetto sbagliato di 15s invece dei suoi 30. Qui la precedenza è l'ordine delle
 * righe, visibile, e una famiglia nuova è una riga.
 *
 * Le assenze sono la parte che conta: `4:3` non esiste su Grok, e l'upscale prende il task_id di
 * Grok e di nessun altro.
 *
 * Fonti: docs.kie.ai, una pagina per modello.
 */

export const GROK_IMAGINE_VIDEO_MODEL = 'grok-imagine-video-1-5-preview';

export const SEEDANCE_25_MODEL = 'bytedance/seedance-2-5';

/**
 * Kie Grok Imagine text ceiling. Prompts longer than this are rejected at createTask
 * ("text length cannot exceed the maximum limit") — declared here so the tools can tell the
 * AI how long a brief may be, and the renderer can clamp before the provider ever sees it.
 */
export const GROK_PROMPT_LIMIT = 4096;

/** Seedance regge un brief molto più lungo di Grok. */
export const SEEDANCE_PROMPT_LIMIT = 10_000;

/**
 * Soft cap for a model-authored video brief (create_post.video_prompt / make_video.prompt).
 * Longer briefs are silently trimmed by the renderer, so the tool rejects them up front and
 * the AI learns the limit instead of wasting a turn.
 */
export const VIDEO_BRIEF_MAX_CHARS = 1200;

// Grok è più stretto; Seedance aggiunge 4:3 / 3:4 / 21:9 / adaptive.
const GROK_RATIOS = ['2:3', '3:2', '1:1', '16:9', '9:16'] as const;
const SEEDANCE_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'] as const;

export const KLING_3_VIDEO_MODEL = 'kling-3.0/video';
export const KLING_3_MOTION_MODEL = 'kling-3.0/motion-control';
export const KLING_TURBO_I2V_MODEL = 'kling/v3-turbo-image-to-video';
export const ALEPH_REFINE_MODEL = 'runway/aleph';

const KLING_RATIOS = ['16:9', '9:16', '1:1'] as const;
const ALEPH_RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'] as const;
const KLING_PROMPT_LIMIT = 2500;

/**
 * I quattro mestieri distinti che si chiamano tutti "video", e che un solo selettore confondeva:
 *
 *   text   — dal nulla, solo parole.
 *   image  — anima UNA immagine che esiste già (la cover renderizzata dalla pipeline immagini).
 *   refine — riscrive una clip che esiste già, tenendo il movimento e cambiando ciò che si vede.
 *   motion — prende il movimento da un video guida e lo applica a un soggetto in una immagine.
 *
 * Non sono gradini della stessa scala: un modello che sa animare una foto può non avere alcun
 * ingresso video, e allora `refine` e `motion` non sono "peggio" — non esistono. Il selettore per
 * un mestiere offre solo chi quel mestiere lo fa, ed è il motivo per cui i ruoli sono una lista
 * per riga e non un livello.
 *
 * NON è il motion video programmatico (Remotion, `motion_write`): quello è codice TSX renderizzato
 * in una VM, non un modello generativo, e non compare qui.
 */
export const VIDEO_ROLES = ['text', 'image', 'refine', 'motion'] as const;
export type VideoRole = (typeof VIDEO_ROLES)[number];

/** La preferenza del brand che governa ogni ruolo, su `content_prefs`. */
export const VIDEO_ROLE_PREF: Record<VideoRole, string> = {
  text: 'videoModel',
  image: 'videoImageModel',
  refine: 'videoRefineModel',
  motion: 'videoMotionModel'
};

export type VideoModelFamily =
  | 'grok-1.5'
  | 'grok-v1'
  | 'seedance-2'
  | 'seedance-2-5'
  | 'kling-3'
  | 'aleph'
  | 'unknown';

export type VideoModelCaps = {
  family: VideoModelFamily;
  /** Provider minimum duration in whole seconds. */
  minDuration: number;
  /** L'UNICO posto in cui la lunghezza di una clip è limitata. */
  maxDuration: number;
  /**
   * Provider prompt ceiling, in characters. Grok rejects anything longer at createTask
   * ("text length cannot exceed the maximum limit") and the failure surfaces as a bare
   * "Video render returned nothing". Unlike images (clamped in buildKieImageInput), video had
   * no clamp: an over-long AI-authored brief silently killed the clip.
   */
  maxPromptChars: number;
  ratios: readonly string[];
  /** Whether grok-imagine/upscale can take this model's task_id. */
  supportsUpscale: boolean;
  /** Whether the job input accepts generate_audio (Seedance). */
  generateAudio: boolean;
};

export type VideoModelSpec = VideoModelCaps & {
  /** L'id stabile: quello che il brand salva e che i tool si passano. */
  id: string;
  label: string;
  /**
   * I mestieri che il modello sa fare. Un ruolo assente qui non è un ruolo servito peggio: è un
   * ruolo che non esiste per questo modello, e il selettore non deve nemmeno offrirlo.
   */
  roles: readonly VideoRole[];
  /**
   * L'id kie PER RUOLO, quando il modello ne cambia a seconda del lavoro. Kling serve la
   * generazione e il motion control con due id diversi sotto lo stesso nome commerciale, e Grok
   * separa il testo dall'immagine: mandare l'id della generazione a un job di motion control è un
   * 400 dopo un giro di rete intero. Un ruolo assente qui usa `id`.
   */
  kieId?: Partial<Record<VideoRole, string>>;
  /**
   * Lo stesso modello nel catalogo video di OpenRouter, che lo chiama in un altro modo: i punti al
   * posto dei trattini, il fornitore davanti. Uno solo per riga — `frame_images` decide il verso, e
   * i due id kie di Grok collassano in uno.
   *
   * Assente vuol dire che su OpenRouter quel modello NON C'È, e il trasporto non lo può servire. È
   * il motivo per cui questa è una riga della tabella e non una regex: un id ricostruito a naso
   * prende un 400 dopo un giro di rete, o peggio ne colpisce un altro.
   */
  openrouterId?: string;
  /**
   * Come si chiama, nel payload kie, il campo che porta il video sorgente. Solo per `refine` e
   * `motion` — gli altri due ruoli non hanno un video in ingresso.
   */
  videoField?: 'video_urls' | 'videoUrl';
  /** Come si chiama il campo dei riferimenti immagine. */
  imageField?: 'image_urls' | 'input_urls' | 'referenceImage';
  /**
   * L'endpoint kie. Quasi tutto vive sull'API a job (`/jobs/createTask`); Runway ha un percorso
   * suo, con i campi in camelCase invece che in snake_case, ed è l'unica ragione per cui questo
   * campo esiste.
   */
  endpoint: 'jobs' | 'aleph';
  /**
   * Ogni altra forma con cui lo stesso modello si presenta. `grok-imagine/text-to-video` è lo
   * stesso modello di `grok-imagine/image-to-video` nell'altro verso: riconoscerli entrambi qui
   * è ciò che impedisce a uno dei due di ripresentarsi come sconosciuto e prendersi la finestra
   * di ripiego invece della propria.
   */
  match: RegExp;
};

/** `seedance-2-5` prima di `seedance-2`, che lo prefissa: la precedenza è l'ordine delle righe. */
const SPECS: VideoModelSpec[] = [
  {
    id: SEEDANCE_25_MODEL,
    label: 'Seedance 2.5',
    openrouterId: 'bytedance/seedance-2.5',
    match: /^bytedance\/seedance-2-5\b/,
    roles: ['text', 'image'],
    endpoint: 'jobs',
    imageField: 'image_urls',
    family: 'seedance-2-5',
    minDuration: 4,
    maxDuration: 30,
    maxPromptChars: SEEDANCE_PROMPT_LIMIT,
    ratios: SEEDANCE_RATIOS,
    supportsUpscale: false,
    generateAudio: true
  },
  {
    id: 'bytedance/seedance-2',
    label: 'Seedance 2',
    openrouterId: 'bytedance/seedance-2.0',
    match: /^bytedance\/seedance-2\b/,
    roles: ['text', 'image'],
    endpoint: 'jobs',
    imageField: 'image_urls',
    family: 'seedance-2',
    minDuration: 4,
    maxDuration: 15,
    maxPromptChars: SEEDANCE_PROMPT_LIMIT,
    ratios: SEEDANCE_RATIOS,
    supportsUpscale: false,
    generateAudio: true
  },
  {
    id: 'bytedance/seedance-2-fast',
    label: 'Seedance 2 Fast',
    openrouterId: 'bytedance/seedance-2.0-fast',
    match: /^bytedance\/seedance-2-fast\b/,
    roles: ['text', 'image'],
    endpoint: 'jobs',
    imageField: 'image_urls',
    family: 'seedance-2',
    minDuration: 4,
    maxDuration: 15,
    maxPromptChars: SEEDANCE_PROMPT_LIMIT,
    ratios: SEEDANCE_RATIOS,
    supportsUpscale: false,
    generateAudio: true
  },
  {
    id: 'bytedance/seedance-2-mini',
    label: 'Seedance 2 Mini',
    openrouterId: 'bytedance/seedance-2.0-mini',
    match: /^bytedance\/seedance-2-mini\b/,
    roles: ['text', 'image'],
    endpoint: 'jobs',
    imageField: 'image_urls',
    family: 'seedance-2',
    minDuration: 4,
    maxDuration: 15,
    maxPromptChars: SEEDANCE_PROMPT_LIMIT,
    ratios: SEEDANCE_RATIOS,
    supportsUpscale: false,
    generateAudio: true
  },
  {
    id: GROK_IMAGINE_VIDEO_MODEL,
    label: 'Grok Imagine',
    openrouterId: 'x-ai/grok-imagine-video-1.5',
    match: /^grok-imagine-video-1-5/,
    roles: ['text', 'image'],
    endpoint: 'jobs',
    imageField: 'image_urls',
    kieId: { text: 'grok-imagine-video-1-5-preview/text-to-video' },
    family: 'grok-1.5',
    minDuration: 1,
    maxDuration: 15,
    maxPromptChars: GROK_PROMPT_LIMIT,
    ratios: GROK_RATIOS,
    supportsUpscale: true,
    generateAudio: false
  },
  {
    id: 'grok-imagine/image-to-video',
    label: 'Grok Imagine v1',
    openrouterId: 'x-ai/grok-imagine-video',
    match: /^grok-imagine\//,
    roles: ['text', 'image'],
    endpoint: 'jobs',
    imageField: 'image_urls',
    kieId: { text: 'grok-imagine/text-to-video', image: 'grok-imagine/image-to-video' },
    family: 'grok-v1',
    minDuration: 1,
    maxDuration: 15,
    maxPromptChars: GROK_PROMPT_LIMIT,
    ratios: GROK_RATIOS,
    supportsUpscale: true,
    generateAudio: false
  },
  {
    // L'unica riga che serve tre mestieri, e con due id kie diversi. `kling-3.0/video` genera da
    // testo e anima una immagine con lo STESSO id (`image_urls` opzionale decide il verso);
    // `kling-3.0/motion-control` e' un altro modello, che vuole ANCHE il video guida.
    id: KLING_3_VIDEO_MODEL,
    label: 'Kling 3.0',
    openrouterId: 'kwaivgi/kling-v3.0-pro',
    match: /^kling-3\.0\//,
    roles: ['text', 'image', 'motion'],
    endpoint: 'jobs',
    imageField: 'image_urls',
    videoField: 'video_urls',
    kieId: { motion: KLING_3_MOTION_MODEL },
    family: 'kling-3',
    minDuration: 3,
    maxDuration: 15,
    maxPromptChars: KLING_PROMPT_LIMIT,
    ratios: KLING_RATIOS,
    supportsUpscale: false,
    generateAudio: true
  },
  {
    id: KLING_TURBO_I2V_MODEL,
    label: 'Kling V3 Turbo',
    match: /^kling\/v3-turbo/,
    // Turbo parte SEMPRE da una immagine: senza `image_urls` non ha nulla da animare, quindi il
    // ruolo `text` non gli appartiene e il selettore della generazione da testo non lo offre.
    roles: ['image'],
    endpoint: 'jobs',
    imageField: 'image_urls',
    family: 'kling-3',
    minDuration: 3,
    maxDuration: 15,
    maxPromptChars: KLING_PROMPT_LIMIT,
    ratios: KLING_RATIOS,
    supportsUpscale: false,
    generateAudio: false
  },
  {
    // Il solo modello che riscrive una clip esistente. Vive fuori dall'API a job, su un endpoint
    // suo e con i campi in camelCase: e' l'intera ragione per cui `endpoint` esiste in questa
    // tabella invece di essere dato per scontato ovunque.
    id: ALEPH_REFINE_MODEL,
    label: 'Runway Aleph',
    match: /^runway\/aleph/,
    roles: ['refine'],
    endpoint: 'aleph',
    videoField: 'videoUrl',
    imageField: 'referenceImage',
    family: 'aleph',
    minDuration: 1,
    maxDuration: 15,
    maxPromptChars: KLING_PROMPT_LIMIT,
    ratios: ALEPH_RATIOS,
    supportsUpscale: false,
    generateAudio: false
  }

];

/** La finestra di ripiego quando l'id non è di nessuno: la più stretta, mai la più generosa. */
const UNKNOWN_CAPS: VideoModelCaps = {
  family: 'unknown',
  minDuration: 1,
  maxDuration: 15,
  maxPromptChars: GROK_PROMPT_LIMIT,
  ratios: GROK_RATIOS,
  supportsUpscale: false,
  generateAudio: false
};

/** Models a brand (or the media-generator UI) can pick. Ids are the I2V form. */
export const VIDEO_MODEL_CHOICES = [
  { id: GROK_IMAGINE_VIDEO_MODEL, label: 'Grok Imagine' },
  { id: SEEDANCE_25_MODEL, label: 'Seedance 2.5' },
  { id: 'bytedance/seedance-2', label: 'Seedance 2' },
  { id: 'bytedance/seedance-2-fast', label: 'Seedance 2 Fast' },
  { id: 'bytedance/seedance-2-mini', label: 'Seedance 2 Mini' }
] as const;

export type VideoModelChoiceId = (typeof VIDEO_MODEL_CHOICES)[number]['id'];

export function isKnownVideoModelId(value: unknown): value is VideoModelChoiceId {
  const v = String(value ?? '').trim();
  return VIDEO_MODEL_CHOICES.some((c) => c.id === v);
}

/**
 * Taglia un brief al tetto del modello che lo eseguirà. Tiene la testa, dove stanno la scena e la
 * regola del frame pulito, e butta solo la coda che il modello avrebbe rifiutato comunque.
 */
export function clampVideoPrompt(prompt: string, model: string): string {
  const limit = videoModelCaps(model).maxPromptChars;
  return prompt.length > limit ? prompt.slice(0, limit).trim() : prompt;
}

/** Lo spec di un modello, da qualunque forma quell'id arrivi. */
export function videoModelSpec(value: unknown): VideoModelSpec | undefined {
  const v = String(value ?? '').trim();
  if (!v) return undefined;
  return SPECS.find((s) => s.id === v || s.match.test(v));
}

/** I modelli che sanno fare QUESTO mestiere: quelli che il selettore di quel ruolo puo' offrire. */
export function videoModelsForRole(role: VideoRole): { id: string; label: string }[] {
  return SPECS.filter((s) => s.roles.includes(role)).map((s) => ({ id: s.id, label: s.label }));
}

/** L'id kie da mandare per QUESTO mestiere: quello del ruolo se il modello ne cambia, o il suo. */
export function kieVideoModel(model: string, role: VideoRole): string {
  const spec = videoModelSpec(model);
  return spec?.kieId?.[role] ?? spec?.id ?? model;
}

/**
 * Il modello scelto dal brand per un mestiere, o undefined se non ne ha scelto uno valido.
 *
 * Due assenze da leggere insieme, perche' la seconda e' la ragione della prima:
 *
 *   · un modello salvato che NON sa fare il mestiere per cui e' salvato viene ignorato. Un brand
 *     conserva le sue preferenze attraverso un cambio di catalogo, e un id che ha perso il ruolo
 *     non deve raggiungere il provider: sarebbe un giro di rete pagato che non torna nulla.
 *   · `image` senza una scelta propria ricade su `text`. Ogni brand che esisteva prima di questo
 *     selettore aveva un `videoModel` solo che copriva entrambi i versi, e leggere la nuova
 *     chiave da sola gli toglierebbe in silenzio la scelta che aveva gia' fatto.
 */
export function videoModelForRole(
  prefs: Record<string, unknown> | null | undefined,
  role: VideoRole
): string | undefined {
  const stored = String(prefs?.[VIDEO_ROLE_PREF[role]] ?? '').trim();
  const spec = videoModelSpec(stored);
  if (spec?.roles.includes(role)) return spec.id;
  if (role === 'image') return videoModelForRole(prefs, 'text');
  return undefined;
}

/** Capabilities of a kie video model id. Unknown ids fall back to the conservative Grok window. */
export function videoModelCaps(model: string): VideoModelCaps {
  return videoModelSpec(model) ?? UNKNOWN_CAPS;
}

export function isSeedance25Model(model: string | null | undefined): boolean {
  return String(model ?? '').trim() === SEEDANCE_25_MODEL;
}

/** Seedance 2 / 2.5 / fast / mini — Kie multimodal refs (incl. reference_video_urls). */
export function isSeedanceFamily(model: string | null | undefined): boolean {
  return /^bytedance\/seedance-2/.test(String(model ?? '').trim());
}

/**
 * Kie Grok Imagine takes image_urls only — not reference videos.
 * Remaking a selected grid video requires Seedance (reference_video_urls).
 */
export function modelSupportsReferenceVideo(model: string | null | undefined): boolean {
  return isSeedanceFamily(model);
}
