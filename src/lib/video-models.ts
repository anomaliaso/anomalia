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

export type VideoModelFamily = 'grok-1.5' | 'grok-v1' | 'seedance-2' | 'seedance-2-5' | 'unknown';

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
    match: /^bytedance\/seedance-2-5\b/,
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
    match: /^bytedance\/seedance-2\b/,
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
    match: /^bytedance\/seedance-2-fast\b/,
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
    match: /^bytedance\/seedance-2-mini\b/,
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
    match: /^grok-imagine-video-1-5/,
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
    match: /^grok-imagine\//,
    family: 'grok-v1',
    minDuration: 1,
    maxDuration: 15,
    maxPromptChars: GROK_PROMPT_LIMIT,
    ratios: GROK_RATIOS,
    supportsUpscale: true,
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

/** Lo spec di un modello, da qualunque forma quell'id arrivi. */
export function videoModelSpec(value: unknown): VideoModelSpec | undefined {
  const v = String(value ?? '').trim();
  if (!v) return undefined;
  return SPECS.find((s) => s.id === v || s.match.test(v));
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
