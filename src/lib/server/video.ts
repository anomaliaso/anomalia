import { UGC_AD_SECONDS, UGC_ORGANIC_SECONDS } from '$lib/ugc-formats';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { videoModel } from '$lib/server/model-routing';
import { getBrandContext, logAiCall } from '$lib/server/ai-log';
import { isVideoUrl } from '$lib/content-formats';
import { KIE_CREDIT_USD } from '$lib/server/kie';
// Il polling dei job di kie, l'estrazione dei crediti e la lettura dell'errore stanno in un file
// solo: immagini e voce girano sulla STESSA API a job, e due copie del ciclo si correggono a metà.
import {
  KIE_JOBS_BASE as KIE_BASE,
  kieJobHeaders as authHeaders,
  createKieTask,
  pollKieTask,
  type KieJobResult as VideoJobResult
} from '$lib/server/kie-jobs';
import {
  VIDEO_MODEL_CHOICES as SHARED_VIDEO_MODEL_CHOICES,
  isKnownVideoModelId,
  isSeedance25Model,
  clampVideoPrompt,
  videoModelCaps,
  videoModelForRole,
  videoModelSpec,
  kieVideoModel,
  type VideoRole
} from '$lib/video-models';
import { nearestAspectRatio } from '$lib/aspect-ratio';
import { route } from '$lib/server/model-routing';
import {
  checkOpenrouterVideo,
  openrouterVideoHeaders,
  openrouterVideoModel,
  renderOpenrouterVideo,
  submitOpenrouterVideo,
  tagOpenrouterJob,
  untagOpenrouterJob
} from '$lib/server/openrouter-video';

// Generazione video vera, via kie. È il percorso a PAGAMENTO: la preview gratuita di onboarding
// non passa mai di qui, quindi un utente free non incorre nel costo video.
//
// IMAGE-TO-VIDEO per primo: con la cover già renderizzata il modello anima QUELLA, quindi tutto il
// grounding fatto dalla pipeline immagini (prodotto vero, identità della persona, palette, QC)
// entra nella clip gratis e il prompt deve dirigere solo il MOVIMENTO. Il text-to-video è il
// ripiego quando la cover non c'è.
//
// Best-effort e NON fatale: a qualunque fallimento si torna undefined e il chiamante ripiega sulla
// cover — un post deve essere sempre creabile, il video è un bonus.

// Grok espone i2v e t2v come due id DISTINTI (Seedance ha un id solo + first_frame_url opzionale).
// I tetti di durata NON sono mai env var: vengono da `videoModelCaps(model)` per il modello che
// esegue davvero il job. Gli id e i default vivono nel registro (`model-routing.ts`).
function envModelI2V(): string {
  return videoModel('i2v');
}
function envModelT2V(): string {
  return videoModel('t2v');
}
// Prende il task_id del job ORIGINALE, mai un URL: per questo l'id resta salvato sul post.
const MODEL_UPSCALE = videoModel('upscale');

// 480p è il default perché kie fattura al secondo e il 720p costa ESATTAMENTE il doppio (misurato:
// 2.4 crediti/s contro 4.5). Ogni bozza si paga, comprese quelle che nessuno approva, quindi il
// default sta sul gradino economico: su un telefono la differenza si vede poco, sul conto no.
export const VIDEO_RESOLUTIONS = ['480p', '720p'] as const;
const DEFAULT_RESOLUTION = env.KIE_VIDEO_RESOLUTION || '480p';

/** Un valore stantio o scritto a mano non deve raggiungere il provider. */
export function clampVideoResolution(value: unknown): string {
  const v = String(value ?? '').trim().toLowerCase();
  return (VIDEO_RESOLUTIONS as readonly string[]).includes(v) ? v : DEFAULT_RESOLUTION;
}
// What an approved clip gets upscaled to. kie's upscale accepts 720p | 1080p.
export const UPSCALE_RESOLUTION = env.KIE_VIDEO_UPSCALE_RESOLUTION || '720p';

export { clampVideoPrompt } from '$lib/video-models';

export type { VideoModelFamily, VideoModelCaps } from '$lib/video-models';
export { videoModelCaps } from '$lib/video-models';

/** Seedance (and similar) use one model id for I2V and T2V; Grok needs a paired T2V id. */
export function pairedTextToVideoModel(model: string): string {
  if (/^bytedance\/seedance-2/.test(model)) return model;
  if (/^grok-imagine-video-1-5/.test(model) || /image-to-video/.test(model)) {
    return envModelT2V();
  }
  return model;
}

/**
 * Precedenza: modello esplicito del tool → scelta del brand PER QUESTO LAVORO → default d'ambiente.
 *
 * `hasCover` non e' un dettaglio di implementazione: e' cio' che distingue i due mestieri. Con una
 * cover il modello ANIMA una immagine che esiste, senza scrive dal nulla, e il brand puo' aver
 * scelto due modelli diversi. Chi chiama non sa ancora quale dei due sara' — la cover si scopre
 * qui — quindi passa le preferenze intere e il ruolo lo decide questa funzione.
 */
export function resolveVideoModel(opts: {
  model?: string | null;
  prefs?: Record<string, unknown> | null;
  hasCover: boolean;
}): string {
  const preferred =
    opts.model?.trim() || videoModelForRole(opts.prefs, opts.hasCover ? 'image' : 'text');
  if (preferred) {
    if (!opts.hasCover) return pairedTextToVideoModel(preferred);
    return preferred;
  }
  return opts.hasCover ? envModelI2V() : envModelT2V();
}

/** Re-export shared allow-list so server callers keep importing from this module. */
export const VIDEO_MODEL_CHOICES = SHARED_VIDEO_MODEL_CHOICES;

export function isKnownVideoModel(value: unknown): value is string {
  return isKnownVideoModelId(value);
}

// Il pavimento di PRODOTTO è più alto del minimo dei provider: sotto i ~10s una clip non regge
// hook → body → cta a ritmo social (~3.5 parole/s con margine) e la cta viene tagliata.
export const MIN_DURATION = 10;
// Ultima spiaggia, quando non si sa nient'altro. NON è il default di prodotto: si preferisce
// sempre `suggestVideoDuration` o una durata esplicita.
export const DEFAULT_VIDEO_DURATION = 13;
/**
 * Talking UGC ceilings.
 * - Organic / feed: {@link UGC_ORGANIC_MAX_DURATION} (15s) on any model.
 * - Paid UGC ads (`ugcAd`): {@link UGC_AD_DURATION} (22s) **only** on Seedance 2.5 —
 *   other models, including the default Grok Imagine, fall back to the organic cap.
 *   The ad flag never picks the model: the selected/brand/default model runs the job.
 */
export const UGC_ORGANIC_MAX_DURATION = UGC_ORGANIC_SECONDS;
export const UGC_AD_DURATION = UGC_AD_SECONDS;
/** @deprecated Prefer {@link UGC_ORGANIC_MAX_DURATION} — kept as alias for organic UGC. */
export const UGC_MAX_DURATION = UGC_ORGANIC_MAX_DURATION;

export type UgcDurationOpts = { ugc?: boolean; /** Paid UGC ad → 22s on Seedance 2.5. */ ugcAd?: boolean };

/** Effective UGC duration ceiling for this model + flags. `null` when not UGC. */
export function ugcDurationCap(
  model: string | null | undefined,
  opts?: UgcDurationOpts
): number | null {
  if (!opts?.ugc) return null;
  if (opts.ugcAd && isSeedance25Model(model)) return UGC_AD_DURATION;
  return UGC_ORGANIC_MAX_DURATION;
}

/** I gradini offerti in Settings, filtrati su ciò che `model` sa davvero produrre. */
export function videoDurationOptions(model?: string | null): number[] {
  const caps = videoModelCaps(model?.trim() || envModelI2V());
  const floor = caps.minDuration;
  const candidates = [10, 13, 15, 20, 22, 30];
  const opts = candidates.filter((s) => s >= floor && s <= caps.maxDuration);
  // Il tetto del modello resta sempre scegliibile, anche se non è uno dei gradini.
  if (!opts.includes(caps.maxDuration) && caps.maxDuration >= floor) opts.push(caps.maxDuration);
  return opts.sort((a, b) => a - b);
}

/**
 * Nella finestra del modello SCELTO, e basta. Il minimo e il tetto vengono ENTRAMBI da
 * `videoModelCaps(model)` — mai una env var, mai una costante globale.
 *
 * C'era un pavimento di prodotto a 10 secondi che vinceva sul minimo dichiarato dal modello, e ha
 * fatto pagare 10 secondi a chi ne aveva chiesti 5: i video si fatturano al secondo, quindi era il
 * doppio, in silenzio. Il catalogo pubblica `supported_durations` per modello e per `wan-3.0`
 * parte da 2.
 *
 * Un DEFAULT si puo' scavalcare, un PAVIMENTO no — ed e' la differenza che questo cambio ripristina.
 * Chi non chiede niente riceve `DEFAULT_VIDEO_DURATION`, che non e' stato toccato; chi chiede una
 * durata la ottiene, se il modello la sa fare.
 */
export function clampVideoDuration(seconds: unknown, model?: string | null): number {
  const caps = videoModelCaps(model?.trim() || envModelI2V());
  const floor = caps.minDuration;
  const fallback = Math.min(Math.max(DEFAULT_VIDEO_DURATION, floor), caps.maxDuration);
  const n = Math.round(Number(seconds));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(caps.maxDuration, Math.max(floor, n));
}

/** Word count for spoken-line duration math (collapsed whitespace). */
export function spokenWordCount(script: string | null | undefined): number {
  return String(script ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;
}

/**
 * La durata dal copione parlato. Il gradino più CORTO che regge tutte le parole, mai quello vicino
 * ma troppo breve: quello tronca a metà frase.
 */
export function suggestVideoDuration(
  script: string | null | undefined,
  model?: string | null,
  opts?: UgcDurationOpts
): number {
  const ugcCap = ugcDurationCap(model, opts);
  const optsList = videoDurationOptions(model).filter((s) =>
    ugcCap != null ? s <= ugcCap : true
  );
  // La durata dell'ad UGC deve restare scegliibile anche se non coincide con un gradino.
  if (ugcCap != null && !optsList.includes(ugcCap) && ugcCap >= (optsList[0] ?? MIN_DURATION)) {
    const caps = videoModelCaps(model?.trim() || envModelI2V());
    if (ugcCap <= caps.maxDuration) optsList.push(ugcCap);
    optsList.sort((a, b) => a - b);
  }
  const floor = optsList[0] ?? MIN_DURATION;
  const words = spokenWordCount(script);
  if (!words) {
    // Gli ad partono dalla finestra piena, così Demo e Proof hanno spazio; l'organico sta al minimo.
    if (opts?.ugc && opts.ugcAd && ugcCap != null) return ugcCap;
    return floor;
  }
  if (!optsList.length) {
    const raw = Math.ceil(words / (WORDS_PER_SECOND * SCRIPT_FIT_RATIO));
    const clamped = clampVideoDuration(raw, model);
    return ugcCap != null ? Math.min(clamped, ugcCap) : clamped;
  }
  const fitting = optsList.find((s) => maxWordsForDuration(s) >= words);
  if (fitting != null) return fitting;
  // Copione più lungo del tetto: si usa il massimo, e `fitScriptToDuration` taglia.
  return optsList[optsList.length - 1]!;
}

/**
 * Richiesta esplicita → suggerimento dal copione → ultima spiaggia. Una preferenza di Settings si
 * passa come `requested`. Fuori dall'UGC, una durata esplicita troppo corta per il parlato CRESCE
 * fino a `suggestVideoDuration` invece di troncare.
 */
export function resolveVideoDuration(
  requested: unknown,
  script: string | null | undefined,
  model?: string | null,
  opts?: UgcDurationOpts
): number {
  const hasScript = spokenWordCount(script) > 0;
  const ugcCap = ugcDurationCap(model, opts);
  const cap = (s: number) => (ugcCap != null ? Math.min(s, ugcCap) : s);

  if (requested != null && requested !== '' && Number.isFinite(Number(requested))) {
    const clamped = cap(clampVideoDuration(requested, model));
    if (!hasScript || opts?.ugc) return clamped;
    if (spokenWordCount(script) <= maxWordsForDuration(clamped)) return clamped;
    return suggestVideoDuration(script, model, opts);
  }
  if (hasScript) return suggestVideoDuration(script, model, opts);
  if (opts?.ugc && opts.ugcAd && ugcCap != null) return ugcCap;
  return cap(clampVideoDuration(undefined, model));
}

/** Pick an aspect ratio the active model accepts; unknown → 9:16. */
export function clampVideoAspectRatio(ratio: unknown, model?: string | null): string {
  const caps = videoModelCaps(model?.trim() || envModelI2V());
  const requested = String(ratio ?? '9:16').trim();
  return (caps.ratios as readonly string[]).includes(requested) ? requested : '9:16';
}

/**
 * Il payload dei due mestieri che hanno un VIDEO in ingresso: rifinire una clip che esiste, e
 * prendere il movimento da una clip per applicarlo al soggetto di una immagine.
 *
 * I due media non sono intercambiabili e nessuno dei due provider lo dice con un errore: su
 * motion control `input_urls` e' il SOGGETTO e `video_urls` e' il movimento, e scambiarli produce
 * una clip plausibile e sbagliata. Aleph poi vive fuori dall'API a job e vuole i campi in
 * camelCase: mandargli `video_urls` e' un 200 con dentro un rifiuto — un giro pagato che non
 * torna nulla. Le due differenze stanno nella tabella, non qui.
 */
export function buildTransformInput(
  model: string,
  role: 'refine' | 'motion',
  args: {
    prompt?: string;
    videoUrl: string;
    imageUrl?: string;
    aspectRatio?: string;
    mode?: 'std' | 'pro';
  }
): Record<string, unknown> {
  const spec = videoModelSpec(model);
  if (!spec?.roles.includes(role)) {
    throw new Error(`${model} does not do ${role}: pick a model that serves that job`);
  }

  const prompt = args.prompt?.trim().slice(0, spec.maxPromptChars) || undefined;

  if (spec.endpoint === 'aleph') {
    return {
      ...(prompt ? { prompt } : {}),
      videoUrl: args.videoUrl,
      aspectRatio: nearestAspectRatio(spec.ratios, String(args.aspectRatio ?? '9:16').trim(), '9:16'),
      ...(args.imageUrl ? { referenceImage: args.imageUrl } : {})
    };
  }

  return {
    ...(prompt ? { prompt } : {}),
    // Il soggetto, non il movimento.
    ...(args.imageUrl ? { input_urls: [args.imageUrl] } : {}),
    // Il movimento, non il soggetto.
    video_urls: [args.videoUrl],
    mode: args.mode ?? 'std'
  };
}

const POLL_INTERVAL_MS = 5000;
// Le clip parlate di Seedance 2.5 stanno regolarmente in coda + render oltre i 3–6 minuti: 180s e
// perfino 360s hanno abortito job vivi come "no video returned" mentre kie stava ancora generando.
// Meglio un'attesa lunga di un falso fallimento.
const POLL_TIMEOUT_MS = 600000;
// L'upscale gira DENTRO il percorso di pubblicazione, con un utente che aspetta: budget molto più
// stretto della generazione, e sforarlo costa solo la risoluzione di bozza, mai il post.
// ponytail: bounded by wall-clock inside the request; if bulk approves with many clips start
// timing out, move the upscale to a `videos/work` cron like radar/knowledge already use.
const UPSCALE_TIMEOUT_MS = 60000;

export type RenderVideoOpts = {
  // Desired clip length in seconds. Clamped into the CHOSEN model's supported window.
  duration?: number;
  // Social video is vertical-first, so we default to 9:16 (Reels/TikTok/Shorts).
  aspectRatio?: '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '2:3' | '3:2' | 'adaptive';
  // Presente → IMAGE-TO-VIDEO: la cover fissa soggetto, scena e stile, e il prompt dirige solo il
  // movimento.
  imageUrl?: string;
  // Brand's free-text clip direction (content_prefs.videoInstructions, Settings → Video).
  instructions?: string | null;
  // Solo nel prompt di ripiego TEXT-TO-VIDEO: con una cover allegata lo stile è già nei pixel.
  visualStyle?: string | null;
  // Font dei sottotitoli impressi: quello del brand vale solo se libass ce l'ha sull'host di render.
  captionFont?: string;
  // Genere UGC a mano invece del default cinematografico. Lo stile visivo del brand qui NON si
  // applica, di proposito — vedi buildVideoPrompt.
  ugc?: boolean;
  /**
   * Paid UGC ad mode. When true with `ugc`, asks for {@link UGC_AD_DURATION} (22s) — which only
   * Seedance 2.5 holds (identity + speech in one pass); other models clamp to the organic
   * {@link UGC_ORGANIC_MAX_DURATION} (15s). The flag never picks the model.
   */
  ugcAd?: boolean;
  // Presente → clip PARLATA: audio e lip-sync nativi si pilotano CITANDO la riga dentro il prompt.
  // Assente → b-roll muto.
  script?: string | null;
  // Shipping resolution from the brand's Settings → Video ('480p' | '720p'). Unset → 480p.
  resolution?: string | null;
  /**
   * AI-authored creative brief for THIS clip. When set, replaces hardcoded UGC / cinematic MOTION
   * templates — chat can fully direct camera, energy, genre. Safety rails (clean frame, spoken
   * line lock, cover anchor) still apply.
   */
  prompt?: string | null;
  /**
   * Structured Seedance shot brief (subject/camera/audio/timeline). Used in UGC mode when
   * `prompt` is absent. Callers pass formatUgcShotBrief(buildUgcShotBrief(...)); otherwise
   * renderVideo builds a default brief.
   */
  shotBrief?: string | null;
  // kie model id override (brand Settings → Video, or an AI tool choice). Unset → env default.
  // Duration is clamped against THIS model's caps, not a global ceiling.
  /** Le preferenze del brand: `resolveVideoModel` ne legge quella del mestiere che questo job e'. */
  prefs?: Record<string, unknown> | null;
  model?: string | null;
  /**
   * Seedance first-frame URL (alias of imageUrl when both set — firstFrameUrl wins).
   * Mutually exclusive with reference_* on kie: if any reference_* is set, frames are omitted.
   */
  firstFrameUrl?: string | null;
  /** Seedance last-frame URL — requires a first frame. Ignored in reference-to-video mode. */
  lastFrameUrl?: string | null;
  /** Seedance multimodal reference videos (public URLs). Max 10 on Seedance 2.5. */
  referenceVideoUrls?: string[] | null;
  /** Seedance multimodal reference audios (public URLs). Max 10 on Seedance 2.5. */
  referenceAudioUrls?: string[] | null;
  /** Seedance multimodal reference images (public URLs). Max 30 on Seedance 2.5. */
  referenceImageUrls?: string[] | null;
  /**
   * Caller's cancellation. A clip render is the longest thing this codebase waits on — pass the
   * turn's signal so a stopped chat (or one out of budget) stops polling instead of holding the
   * invocation open for the full {@link POLL_TIMEOUT_MS}.
   */
  abortSignal?: AbortSignal;
  /**
   * Override burned-in (ffmpeg) captions. Default: !!script && !ugc.
   * Remakes of existing reels pass false so a UGC script rewrite cannot add subtitles
   * the original clip never had.
   */
  burnCaptions?: boolean;
};

// Ritmo veloce da short form: a 2.0 parole/s la recitazione esce lenta e strascicata, che nessuno
// usa sui social. Fit e suggest lasciano comunque un margine perché la riga finisca.
export const WORDS_PER_SECOND = 3.5;

/** Il resto è un battito dopo l'ultima parola. */
export const SCRIPT_FIT_RATIO = 0.92;

/** Max spoken words that fit in `seconds` without audibly truncating. */
export function maxWordsForDuration(seconds: number): number {
  return Math.max(1, Math.floor(seconds * WORDS_PER_SECOND * SCRIPT_FIT_RATIO));
}

/**
 * Guide di pronuncia per i nomi che il TTS storpia. FUORI dalla riga citata, o il lip-sync perde
 * l'ortografia: la citazione fissa le lettere, questa fissa il suono.
 */
export function brandPronunciationHints(script: string | null | undefined): string {
  const text = String(script ?? '');
  if (!/\banomalia\b/i.test(text)) return '';
  return [
    'PRONUNCIATION — Italian brand name, even if the rest of the line is English:',
    '"Anomalia" = ah-no-MAH-lyah (Italian /anoˈmalja/, stress on MA, final "lia" as one soft "lyah").',
    'NOT English "anomaly". NEVER Anomida, Anonimita, Annanomita, Anonimia, or Anomaly-uh.'
  ].join(' ');
}

// Un confine di frase dentro la finestra, così non si spedisce mai una proposizione mozzata;
// altrimenti un confine di parola.
export function fitScriptToDuration(script: string, seconds: number): string {
  const words = script.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const max = maxWordsForDuration(seconds);
  if (words.length <= max) return words.join(' ');
  const cut = words.slice(0, max);
  for (let i = cut.length - 1; i >= Math.max(1, Math.floor(cut.length * 0.5)); i--) {
    if (/[.!?]"?$/.test(cut[i])) return cut.slice(0, i + 1).join(' ');
  }
  return cut.join(' ');
}

// L'`image_prompt` salvato descrive uno STILL: mandarlo verbatim produce clip generiche che
// reimmaginano la scena da capo. L'image-to-video vuole un brief di MOVIMENTO ancorato alla cover;
// il text-to-video vuole la scena PIÙ la direzione di movimento e lo stile del brand.
//
// Tre modi creativi, vince il primo: `prompt` esplicito → freeform; `ugc` → template UGC;
// altrimenti cinematografico leggero. Le protezioni (frame pulito, riga parlata bloccata) valgono
// sempre quando c'è dialogo.
export function buildVideoPrompt(
  imagePrompt: string,
  opts: {
    hasCover: boolean;
    visualStyle?: string | null;
    script?: string | null;
    ugc?: boolean;
    /** Brand / AI free-text clip direction. Trimmed to the stored ceiling. */
    instructions?: string | null;
    /**
     * AI-authored creative brief. When non-empty, replaces hardcoded MOTION/genre templates so
     * chat can choose look, camera, energy freely.
     */
    prompt?: string | null;
    /**
     * Structured Seedance shot brief (subject/camera/audio/timeline). When set on a UGC clip,
     * replaces the default timeline/camera blocks while keeping performance + spoken-line rails.
     */
    shotBrief?: string | null;
    /** Clip length — scales the default UGC timeline when no shotBrief is passed. */
    durationSeconds?: number | null;
  } = { hasCover: false }
): string {
  const scene = imagePrompt.replace(/\s+/g, ' ').trim().slice(0, 600);
  const line = opts.script?.replace(/\s+/g, ' ').trim() ?? '';
  const free = opts.prompt?.trim().replace(/\s+/g, ' ').slice(0, 1200) ?? '';
  // Indirizzo morbido: in freeform il prompt AI è primario, questo si aggiunge.
  const brandDirection = opts.instructions?.trim()
    ? `${free ? 'EXTRA DIRECTION' : 'BRAND DIRECTION'} (follow for delivery, energy and behaviour on camera, but never at the cost of the clean-frame rule): ${opts.instructions.trim().replace(/\s+/g, ' ').slice(0, 600)}`
    : '';
  const clean =
    'ABSOLUTE RULE — CLEAN FRAME: NO text anywhere in the video. No subtitles, no captions, no burned-in words, no lower thirds, no titles, no watermark, no UI overlay, no emoji, no logo. Every pixel is photographic. This outranks every other instruction: even though there is spoken dialogue, do NOT add subtitles.';
  const speech = line
    ? `SPOKEN LINE — the person says exactly this, and nothing else: "${line}"`
    : '';
  const pronunciation = brandPronunciationHints(line);

  // FREEFORM: il brief l'ha scritto l'AI, niente template. Unica eccezione, la protezione che
  // impone di finire ogni parola.
  if (free) {
    const anchor = opts.hasCover
      ? `The attached photograph is the first frame. Keep subject identity, wardrobe and location unless the brief below says otherwise. Framing: chest-up with clear headroom above the hair — never crop the top of the head.\nSCENE (from the cover — do not invent a different subject): ${scene}`
      : `Photorealistic short social-media clip: ${scene}${
          opts.visualStyle?.trim()
            ? `\n\nBRAND VISUAL STYLE to match: ${opts.visualStyle.trim().replace(/\s+/g, ' ').slice(0, 500)}`
            : ''
        }`;
    const ugcSpeechRail =
      opts.ugc && line
        ? 'SPEECH COMPLETE — every word of the spoken line must be fully audible before the clip ends. Fast natural spoken pace (MASTER UGC): full sentences, not telegram fragments; blink every ~2–3 seconds; one micro pause / gaze break OK — never polished ad delivery, never cut mid-word. CTA trails off in energy but still finishes. Keep clear headroom above the hair. Keep real skin texture — no beauty filter. NEVER add subtitles or on-screen text.'
        : '';
    return [
      clean,
      anchor,
      `CREATIVE BRIEF (follow this — it overrides default motion/genre templates):\n${free}`,
      speech,
      pronunciation,
      ugcSpeechRail,
      brandDirection,
      // Il frame pulito si ripete per ultimo: col dialogo il modello tende ai sottotitoli.
      line || free ? clean : ''
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // L'UGC è un GENERE diverso, non una manopola di stile: il brief cinematografico qui sotto gli
  // rema contro, quindi il prompt si sostituisce invece di aggiustarsi.
  // La regola del frame pulito è dichiarata DUE volte, in testa e in coda: col dialogo nel prompt
  // il modello aggiunge sottotitoli per default, e una sola menzione a metà prompt non lo ferma —
  // poi storpia le lettere, che è peggio di nessun sottotitolo. I nostri si imprimono dopo, dove
  // controlliamo font e ortografia.
  if (opts.ugc) {
    // `ugc.ts` non si importa qui: creerebbe un ciclo (ugc importa già SCRIPT_FIT_RATIO da questo
    // file), quindi il brief lo passa il chiamante.
    const shotBlock = opts.shotBrief?.trim() ?? '';

    const defaultShot = [
      'SHOT BRIEF — Seedance blocks (Hook→Problem→Demo→Proof→CTA; pain moment + desire under):',
      'REFERENCES: @Image 1 = speaker face/hair/build/wardrobe/room from the cover — do not invent a different person',
      `CAMERA: handheld front-camera selfie, chest-up with headroom, ${'natural micro-shakes, drifting frames, hunting autofocus, uneven light'} — no tripod, no cinematic move; keep real skin texture (no beauty filter)`,
      'LOOK: visible pores, under-eye shadows, flat grading, faint sensor noise — no doll/porcelain skin',
      'STYLE: talking-head UGC; expressive pain→relief; product must NOT lead the first ~8s',
      'AUDIO: phone-mic room tone + one quiet ambient event. No music, no studio VO',
      'STAGES:',
      '- 00:00–~15%: HOOK call-out — PAIN MOMENT + desire underneath; brows knit, lean in; NO product yet',
      '- ~15%–~35%: PROBLEM — deepen cost (time/money/stress/shame); face stays worked up; blink ~2–3s; behavioral beats',
      '- ~35%–~60%: DEMO — give away the mechanic out loud in one concrete step; product may appear casually',
      '- ~60%–~80%: PROOF — relief shift (shoulders drop, softer eyes); one concrete proof detail',
      '- ~80%–end: CTA — qualify then soft action, trailing off; every spoken word finishes',
      'CONSTRAINTS: NO subtitles/captions/UI text/logos; NO beauty filter; SPEECH COMPLETE'
    ].join('\n');

    const delivery = line
      ? [
          shotBlock || defaultShot,
          '',
          'PERFORMANCE — expressive pain→relief UGC ad, never a polished commercial:',
          '- Social context truth: mid-conversation / thinking out loud — never presenting.',
          '- PAIN + DESIRE: hook names a concrete painful moment; the desire underneath (comfort / respect / less fear) must be felt on the face.',
          '- EXPRESSIVE ARC (mandatory): HOOK/PROBLEM = brows knit, lean in; DEMO = show the mechanic; PROOF = visible relief (shoulders drop, softer eyes); CTA trails off. Not deadpan. Not constant hype.',
          '- Micro-expressions: eyebrow movement on the pain, lip tension then release on the proof. Blink every ~2–3 seconds.',
          '- Thought-while-talking: fast natural speech, light slang if in the line, one real pause. No telegram fragments.',
          '- Alive environment + UGC flaws: micro-shakes, hunting focus, uneven light, room tone.',
          '- BEHAVIORAL BEATS — pick 2–3 (if the shot brief names them, do THOSE): glance away • lean back • shrug • adjust phone grip • react to a sound • half-laugh at own sentence.',
          '- Lips stay synced. Same face and real skin texture as the first frame — no beauty filter.',
          '- NO SUBTITLES / NO readable UI text — ever. Spoken audio only.',
          '- Do NOT add, drop or rewrite any word of the spoken line.',
          'SPEECH COMPLETE — every word audible. Fast natural spoken pace with regular blinks; never cut mid-word. CTA trails off but still finishes.',
          '',
          speech,
          pronunciation,
          'Not a presenter — someone venting a problem who found a fix and kept filming.'
        ].join('\n')
      : [
          shotBlock || defaultShot,
          '',
          'MOTION: natural handheld movement only — subject shifting slightly, blinking every ~2–3s, expressive face, alive background. Keep skin texture and identity from the first frame. AUDIO: phone-mic room tone only, no music. NO subtitles.'
        ].join('\n');
    // Talking head puro: identità bloccata per tutta la ripresa.
    const fidelity =
      'FIDELITY: same face, skin texture, clothes and location throughout. No morphing, no scene change, no new people, no flicker, no beauty filter.';
    return [
      clean,
      'Unedited raw footage from a handheld phone front camera. The attached photograph is the first frame — keep the same person, room, wardrobe and skin texture.',
      delivery,
      fidelity,
      brandDirection,
      clean
    ].filter(Boolean).join('\n\n');
  }
  // Una clip parlata ha bisogno che le LABBRA si muovano: il brief da b-roll muto permette solo
  // movimento ambientale e combatterebbe il dialogo.
  const motion = line
    ? 'MOTION: the person in frame speaks the line below directly to camera, with natural lip-sync, facial expression and small head movement. Keep the camera nearly still (at most a very slow push-in). No rapid cuts, no zoom bursts, no shaky handheld.'
    : 'MOTION: one subtle, cinematic camera move that fits the scene (slow push-in, gentle pan or soft parallax) plus natural in-scene motion only where believable (light shifting, steam rising, fabric or hair moving, a hand adjusting the product). Calm, controlled pacing — no rapid cuts, no zoom bursts, no shaky handheld.';
  // I sottotitoli sono affare NOSTRO (font del brand, ortografia giusta), mai del modello: storpia
  // le lettere e la storpiatura cambia da frame a frame.
  const fidelity =
    'FIDELITY: keep the subject, composition, colours and materials faithful for the entire clip. No morphing or warping, no scene change, no new objects or people appearing, no on-screen text or logos, no flicker.';
  // Citare la riga verbatim è il modo documentato di pilotare l'audio nativo. Nient'altro può
  // essere pronunciato: senza il vincolo il modello improvvisa dialogo sopra il messaggio del brand.
  const speechBlock = line
    ? `${speech}${pronunciation ? `\n${pronunciation}` : ''}\nNatural, conversational delivery that suits the scene. No voice-over narrator, no other speech, no background dialogue.`
    : '';
  if (opts.hasCover) {
    return [
      'Animate the attached image into a short, premium social-media clip.',
      `SCENE (already fixed by the attached image — do not change it): ${scene}`,
      motion,
      speechBlock,
      fidelity,
      brandDirection
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  const style = opts.visualStyle?.trim()
    ? `\n\nBRAND VISUAL STYLE to match: ${opts.visualStyle.trim().replace(/\s+/g, ' ').slice(0, 500)}`
    : '';
  return [`Photorealistic, premium short social-media clip: ${scene}`, motion, speechBlock, `${fidelity}${style}`, brandDirection]
    .filter(Boolean)
    .join('\n\n');
}

export type RenderedVideo = {
  // Public, permanent URL of the persisted mp4 in our own Storage bucket.
  url: string;
  // La fatturazione è al secondo: è l'unità su cui si riconcilia la spesa.
  durationSeconds: number;
  // L'unico appiglio che upscale/extend accettano: va persistito.
  taskId: string;
  // Resolution the stored mp4 is at, so the publish path knows whether it still needs upscaling.
  resolution: string;
  // La cover da cui la clip è stata animata: è il poster nel feed, l'ancora di stile per
  // "rigenera cambiando X" e l'input di un nuovo render. undefined solo per il text-to-video.
  thumbnailUrl?: string;
};

// Le famiglie supportate non concordano quasi su nessun nome di campo: questo è l'unico posto che
// conosce la differenza.
//
//   grok-imagine-video-1-5*  image_urls: [url]   duration INTEGER   aspect_ratio only without cover
//   grok-imagine/*           image_urls: [url]   duration STRING    aspect_ratio only without cover
//   bytedance/seedance-2*    first/last frame OR reference_* (mutually exclusive on kie)
//
// Seedance generate_audio is on only for a talking clip — audio on silent b-roll is wasted spend.
export function buildJobInput(
  model: string,
  opts: {
    prompt: string;
    durationSeconds: number;
    resolution: string;
    aspectRatio: string;
    imageUrl?: string;
    hasScript?: boolean;
    lastFrameUrl?: string;
    referenceVideoUrls?: string[];
    referenceAudioUrls?: string[];
    referenceImageUrls?: string[];
  }
): Record<string, unknown> {
  const { prompt, durationSeconds, resolution, aspectRatio, imageUrl } = opts;
  // Un breve troppo lungo viene rifiutato da kie alla submit: qui si taglia a monte, per ogni
  // famiglia, perché è l'unico posto dove modello e prompt si incontrano prima di partire.
  const clampedPrompt = clampVideoPrompt(prompt, model);
  // La 1-5 rompe con la famiglia v1 proprio sul campo che fallirebbe in SILENZIO: qui `duration` è
  // un intero, lì una stringa. `aspect_ratio` è rifiutato con una singola immagine allegata.
  if (/^grok-imagine-video-1-5/.test(model)) {
    return {
      prompt: clampedPrompt,
      duration: durationSeconds, // integer, [1, 15]
      resolution,
      ...(imageUrl ? { image_urls: [imageUrl] } : { aspect_ratio: aspectRatio })
    };
  }
  // kie tratta i2v con first/last frame e reference-to-video come MUTUAMENTE ESCLUSIVI: con dei
  // reference presenti vincono loro. Seedance 2.5 con first/last frame accetta solo
  // aspect_ratio "adaptive" (altrimenti 422).
  if (/^bytedance\/seedance-2/.test(model)) {
    const refImages = (opts.referenceImageUrls ?? []).map((u) => u.trim()).filter(Boolean).slice(0, 30);
    const refVideos = (opts.referenceVideoUrls ?? []).map((u) => u.trim()).filter(Boolean).slice(0, 10);
    const refAudios = (opts.referenceAudioUrls ?? []).map((u) => u.trim()).filter(Boolean).slice(0, 10);
    const useRefs = refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0;
    const is25 = /^bytedance\/seedance-2-5\b/.test(model);
    const hasFrames = !!imageUrl || !!opts.lastFrameUrl?.trim();
    const ratio =
      is25 && hasFrames && !useRefs
        ? 'adaptive'
        : aspectRatio;
    const input: Record<string, unknown> = {
      prompt: clampedPrompt,
      duration: durationSeconds, // integer, not a string
      resolution,
      aspect_ratio: ratio,
      generate_audio: !!opts.hasScript
    };
    if (useRefs) {
      if (refImages.length) input.reference_image_urls = refImages;
      if (refVideos.length) input.reference_video_urls = refVideos;
      if (refAudios.length) input.reference_audio_urls = refAudios;
    } else {
      if (imageUrl) input.first_frame_url = imageUrl;
      // `last_frame_url` da solo non si può: kie pretende anche `first_frame_url`.
      const last = opts.lastFrameUrl?.trim();
      if (imageUrl && last) input.last_frame_url = last;
    }
    return input;
  }
  return {
    prompt: clampedPrompt,
    duration: String(durationSeconds),
    resolution,
    // Con una cover la clip eredita le dimensioni dell'immagine: un ratio contraddittorio confonde.
    ...(imageUrl ? { image_urls: [imageUrl] } : { aspect_ratio: aspectRatio })
  };
}

/**
 * CHI serve questo render. L'unico posto che lo decide, e l'unico che può dire di no a OpenRouter.
 *
 * Il registro sceglie l'endpoint; qui si aggiungono i due motivi per cui quella scelta non si può
 * onorare per QUESTO render. Entrambi sono rumorosi di proposito: un ripiego silenzioso su kie
 * mentre la variabile dice openrouter è esattamente il guasto che `SERVED_BY` esiste per impedire,
 * e non lascerebbe traccia da nessuna parte.
 */
function videoEndpoint(model: string, opts: { hasRefs?: boolean } = {}): 'kie' | 'openrouter' {
  if (route('video').endpoint !== 'openrouter') return 'kie';

  if (!openrouterVideoModel(model)) {
    console.warn(`[video] AI_ROUTE_VIDEO chiede openrouter ma ${model} non è nel suo catalogo video: ripiego su kie.`);
    return 'kie';
  }
  // I `reference_*` di Seedance non esistono sulla superficie video di OpenRouter: mandarli lì
  // significherebbe girare la clip SENZA i riferimenti, con un 200 e nessun errore.
  if (opts.hasRefs) {
    console.warn('[video] i riferimenti non passano da openrouter: questo render resta su kie.');
    return 'kie';
  }
  return 'openrouter';
}

async function runVideoJob(
  endpoint: 'kie' | 'openrouter',
  model: string,
  prompt: string,
  durationSeconds: number,
  aspectRatio: string,
  resolution: string,
  opts: {
    imageUrl?: string;
    hasScript?: boolean;
    lastFrameUrl?: string;
    referenceVideoUrls?: string[];
    referenceAudioUrls?: string[];
    referenceImageUrls?: string[];
    abortSignal?: AbortSignal;
  } = {}
): Promise<(VideoJobResult & { costUsd?: number }) | undefined> {
  if (endpoint === 'openrouter') {
    const out = await renderOpenrouterVideo(
      { model, prompt, durationSeconds, resolution, aspectRatio, imageUrl: opts.imageUrl, lastFrameUrl: opts.lastFrameUrl },
      { signal: opts.abortSignal, context: 'inline' }
    );
    // Come su kie: una scadenza non riapre niente. Il job resta del fornitore col suo id.
    return out.status === 'done' ? { url: out.url, taskId: tagOpenrouterJob(out.jobId), costUsd: out.costUsd } : undefined;
  }
  const taskId = await createKieTask(
    model,
    buildJobInput(model, {
      prompt,
      durationSeconds,
      resolution,
      aspectRatio,
      imageUrl: opts.imageUrl,
      hasScript: opts.hasScript,
      lastFrameUrl: opts.lastFrameUrl,
      referenceVideoUrls: opts.referenceVideoUrls,
      referenceAudioUrls: opts.referenceAudioUrls,
      referenceImageUrls: opts.referenceImageUrls
    }),
    opts.abortSignal,
    'video'
  );
  if (!taskId) return undefined;
  const job = await pollKieTask(taskId, POLL_TIMEOUT_MS, opts.abortSignal, 'video', POLL_INTERVAL_MS);

  // Una scadenza non riapre niente: il task resta di kie, e chi passa dalla coda lo ripesca dal
  // `task_id` che ha gia' scritto. Aprire un secondo task qui pagherebbe due volte lo stesso clip.
  return job.status === 'done' ? job : undefined;
}

// Gli URL di kie non sono permanenti. La RLS dello Storage pretende che il primo segmento del path
// sia `auth.uid()`, quindi ogni oggetto vive sotto `{userId}/…`.
async function persistMp4(
  supabase: SupabaseClient,
  userId: string,
  srcUrl: string,
  opts: { captions?: boolean; fontName?: string; tighten?: boolean; headers?: Record<string, string> } = {}
): Promise<string | undefined> {
  const dl = await fetch(srcUrl, opts.headers ? { headers: opts.headers } : undefined);
  if (!dl.ok) return undefined;
  let bytes: Buffer = Buffer.from(await dl.arrayBuffer());
  // Il vuoto in testa e in coda si taglia PRIMA dei sottotitoli, o il timing non corrisponde al
  // montaggio spedito. Le micro-pause interne restano: sono il mestiere.
  if (opts.tighten !== false) {
    const { tightenDeadSpace } = await import('$lib/server/video-edit');
    bytes = await tightenDeadSpace(bytes);
  }
  // Impressi PRIMA dell'upload, così lo Storage tiene solo il montaggio spedibile: una clip
  // parlata la guarda muta la maggior parte del pubblico.
  if (opts.captions) {
    const { burnCaptions } = await import('$lib/server/captions');
    bytes = await burnCaptions(bytes, { fontName: opts.fontName });
  }
  // AI Act Art. 50(2): il montaggio spedibile va marcato come sintetico. Stream copy, zero costo
  // di qualità, e un tag fallito restituisce la clip intatta invece di perderla.
  {
    const { markVideoSynthetic } = await import('$lib/server/content-credentials');
    bytes = await markVideoSynthetic(bytes);
  }
  const path = `${userId}/generated/${crypto.randomUUID()}.mp4`;
  const { error } = await supabase.storage.from('media').upload(path, bytes, {
    contentType: 'video/mp4',
    upsert: false
  });
  if (error) return undefined;
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}

/**
 * Tutto ciò che va deciso prima di parlare a kie: modello, durata, prompt, e le opzioni che
 * serviranno a finire il lavoro molto dopo che questa richiesta sarà finita.
 *
 * Separato perché un render si può attendere inline o consegnare a un riconciliatore: le decisioni
 * sono le stesse, cambia solo l'attesa, e duplicarle è il modo in cui i due percorsi divergono.
 */
type PreparedRender = {
  model: string;
  prompt: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: string;
  cover?: string;
  script?: string;
  lastFrame?: string;
  referenceVideoUrls: string[];
  referenceAudioUrls: string[];
  referenceImageUrls: string[];
  persistOpts: VideoPersistOpts;
};

/** What persistMp4 needs, kept whole because the request that computed it will not exist later. */
export type VideoPersistOpts = {
  captions: boolean;
  fontName?: string;
  tighten: boolean;
};

export async function renderVideo(
  supabase: SupabaseClient,
  userId: string,
  imagePrompt: string,
  opts: RenderVideoOpts = {}
): Promise<RenderedVideo | undefined> {
  const prepared = await prepareVideoRender(imagePrompt, opts);
  return runPreparedRender(supabase, userId, prepared, opts.abortSignal);
}

async function prepareVideoRender(
  imagePrompt: string,
  opts: RenderVideoOpts = {}
): Promise<PreparedRender> {
  if (!env.KIE_API_KEY) {

    throw new Error('KIE_API_KEY not configured');
  }

  // Una clip è la cosa più cara che il motore possa comprare: un brand a crediti esauriti non deve
  // poterci spendere da NESSUN percorso. L'import dinamico evita il ciclo crediti↔ai-log, e
  // `CreditsExhaustedError` si propaga — l'utente deve sapere che è a secco, non vedere una cover
  // come se il modello avesse fallito.
  const gateBrand = getBrandContext();
  if (gateBrand) {
    const { gateCredits } = await import('$lib/server/credits');
    await gateCredits(gateBrand);
  }

  // `image_urls` / `first_frame_url` accettano solo still: un post che porta già una clip non deve
  // finire lì dentro come riferimento immagine.
  const firstFrameRaw = opts.firstFrameUrl?.trim() || opts.imageUrl?.trim() || undefined;
  const cover = firstFrameRaw && !isVideoUrl(firstFrameRaw) ? firstFrameRaw : undefined;
  const lastFrameRaw = opts.lastFrameUrl?.trim() || undefined;
  const lastFrame = lastFrameRaw && !isVideoUrl(lastFrameRaw) ? lastFrameRaw : undefined;
  const referenceVideoUrls = (opts.referenceVideoUrls ?? []).map((u) => u.trim()).filter(Boolean);
  const referenceAudioUrls = (opts.referenceAudioUrls ?? []).map((u) => u.trim()).filter(Boolean);
  const referenceImageUrls = (opts.referenceImageUrls ?? []).map((u) => u.trim()).filter(Boolean);
  const hasRefs =
    referenceVideoUrls.length > 0 || referenceAudioUrls.length > 0 || referenceImageUrls.length > 0;
  // Prima il modello: i tetti di durata e ratio sono proprietà di QUESTO modello, non globali.
  // L'ad UGC non impone il modello: 22s solo su Seedance 2.5 (`ugcDurationCap`), altrimenti tetto
  // organico 15s sul default (Grok Imagine).
  const model = resolveVideoModel({ model: opts.model, prefs: opts.prefs, hasCover: !!cover || hasRefs });

  const durationSeconds = resolveVideoDuration(
    opts.duration ?? (opts.ugc && opts.ugcAd ? UGC_AD_DURATION : undefined),
    opts.script,
    model,
    { ugc: !!opts.ugc, ugcAd: !!opts.ugcAd }
  );
  const aspectRatio = clampVideoAspectRatio(opts.aspectRatio ?? '9:16', model);

  const resolution = clampVideoResolution(opts.resolution ?? DEFAULT_RESOLUTION);
  // Si taglia solo se il copione supera ancora la durata dopo la risoluzione.
  const script = opts.script?.trim() ? fitScriptToDuration(opts.script, durationSeconds) : undefined;
  let shotBrief = opts.shotBrief?.trim() || undefined;
  if (!shotBrief && opts.ugc && !opts.prompt?.trim()) {
    try {
      const { buildUgcShotBrief, formatUgcShotBrief } = await import('$lib/server/ugc');
      const brief = buildUgcShotBrief({
        seconds: durationSeconds,
        hook: script?.slice(0, 160),
        script
      });
      shotBrief = formatUgcShotBrief(brief, { script });
    } catch {
      shotBrief = undefined;
    }
  }
  const prompt = buildVideoPrompt(imagePrompt, {
    hasCover: !!cover || hasRefs,
    visualStyle: opts.visualStyle,
    script,
    ugc: opts.ugc,
    instructions: opts.instructions,
    prompt: opts.prompt,
    shotBrief,
    durationSeconds
  });

  return {
    model,
    prompt,
    durationSeconds,
    aspectRatio,
    resolution,
    cover,
    script,
    lastFrame,
    referenceVideoUrls,
    referenceAudioUrls,
    referenceImageUrls,
    persistOpts: {
      // MAI sull'UGC. Le altre clip parlate sì, per chi guarda muto; il b-roll non ha niente da
      // imprimere.
      captions: opts.burnCaptions !== undefined ? !!opts.burnCaptions && !!script : !!script && !opts.ugc,
      fontName: opts.captionFont,
      // Il taglio del vuoto vale su ogni clip parlata; il b-roll muto si lascia stare.
      tighten: !!script
    }
  };
}

/** Il percorso inline: invia, aspetta kie, fattura, persiste. */
async function runPreparedRender(
  supabase: SupabaseClient,
  userId: string,
  p: PreparedRender,
  abortSignal?: AbortSignal
): Promise<RenderedVideo | undefined> {
  const { model, prompt, durationSeconds, aspectRatio, resolution, cover, script, lastFrame } = p;
  const { referenceVideoUrls, referenceAudioUrls, referenceImageUrls } = p;
  const t0 = Date.now();
  const endpoint = videoEndpoint(model, {
    hasRefs: referenceVideoUrls.length > 0 || referenceAudioUrls.length > 0 || referenceImageUrls.length > 0
  });
  try {
    const job = await runVideoJob(endpoint, model, prompt, durationSeconds, aspectRatio, resolution, {
      imageUrl: cover,
      hasScript: !!script,
      lastFrameUrl: lastFrame,
      referenceVideoUrls,
      referenceAudioUrls,
      referenceImageUrls,
      abortSignal
    });
    // L'addebito ESATTO di kie: un job fallito o scaduto kie non lo fattura, quindi non lo
    // fatturiamo al brand. Il brandId arriva dallo scope, quindi il costo cade in ai_calls e da lì
    // nella quota.
    // Su openrouter la riga in `ai_calls` l'ha gia' scritta il trasporto, che e' l'unico a
    // conoscere il `jobId` e il costo fatturato — anche quando il job e' SCADUTO e qui non arriva.
    if (endpoint === 'kie') {
      logAiCall({
        label: 'video.render',
        provider: 'kie',
        model,
        prompt,
        ms: Date.now() - t0,
        ok: !!job,
        error: job ? undefined : 'no video returned',
        ...(job?.credits != null
          ? { providerCredits: job.credits, flatCostUsd: Math.round(job.credits * KIE_CREDIT_USD * 1e6) / 1e6 }
          : {}),
        context: `${durationSeconds}s ${resolution}`
      });
    }
    if (!job) return undefined;

    const url = await persistMp4(supabase, userId, job.url, {
      ...p.persistOpts,
      ...(endpoint === 'openrouter' ? { headers: openrouterVideoHeaders() } : {})
    });
    if (!url) return undefined;
    // taskId e risoluzione tornano indietro perché sono ciò che rende possibile l'upscale
    // all'approvazione senza rigenerare la clip. `thumbnailUrl` è la COVER: senza restituirla il
    // chiamante sovrascrive media_url con la clip e il frame è perso, con tutto il grounding
    // (prodotto, identità, palette, QC) che c'era dentro.
    return { url, durationSeconds, taskId: job.taskId, resolution, thumbnailUrl: cover };
  } catch {
    // Non fatale: il chiamante ripiega sulla cover.
    return undefined;
  }
}

/**
 * Runway vive su un percorso suo: `/aleph/generate` per inviare e `/runway/record-detail` per
 * chiedere, con lo stato in `data.state` e l'URL in `data.videoInfo.videoUrl`. Nessuno dei due
 * combacia con l'API a job, e questa e' l'unica ragione per cui la tabella dichiara `endpoint`.
 */
async function runAlephJob(
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<VideoJobResult | undefined> {
  const res = await fetch(`${KIE_BASE}/aleph/generate`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
    signal
  });
  if (!res.ok) {
    console.error(`[video.transform] aleph generate ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`);
    return undefined;
  }
  const created = await res.json();
  const taskId = created?.data?.taskId ?? created?.data?.task_id;
  if (!taskId) {
    console.error(`[video.transform] aleph rifiutata: ${String(created?.msg ?? JSON.stringify(created)).slice(0, 400)}`);
    return undefined;
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let first = true;
  while (Date.now() < deadline) {
    if (signal?.aborted) return undefined;
    if (!first) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    first = false;
    const infoRes = await fetch(`${KIE_BASE}/runway/record-detail?taskId=${encodeURIComponent(taskId)}`, {
      headers: authHeaders(),
      signal
    });
    if (!infoRes.ok) continue;
    const info = await infoRes.json();
    const state = info?.data?.state;
    if (state === 'fail') {
      console.error(`[video.transform] aleph fallita: ${String(info?.data?.failMsg ?? '').slice(0, 400)}`);
      return undefined;
    }
    const url = info?.data?.videoInfo?.videoUrl;
    if (state === 'success' && url) return { url: String(url), taskId };
  }
  return undefined;
}

/**
 * I due mestieri che partono da un video che esiste gia\'.
 *
 * Tornano `undefined` e non lanciano, come ogni altro render qui: una clip che non riesce non deve
 * portarsi via il post da cui e\' partita.
 *
 * La clip finita si RIOSPITA (`persistMp4`): gli URL dei provider scadono — quello di Runway in 14
 * giorni — e un post che punta a un URL scaduto e\' un post senza video, mesi dopo, senza un errore
 * da nessuna parte.
 */
export async function transformVideo(opts: {
  supabase: SupabaseClient;
  userId: string;
  role: VideoRole & ('refine' | 'motion');
  videoUrl: string;
  prompt?: string;
  imageUrl?: string;
  aspectRatio?: string;
  mode?: 'std' | 'pro';
  model?: string | null;
  prefs?: Record<string, unknown> | null;
  abortSignal?: AbortSignal;
}): Promise<{ url: string; taskId: string; model: string } | undefined> {
  const model = opts.model?.trim() || videoModelForRole(opts.prefs, opts.role);
  if (!model) return undefined;

  const gateBrand = getBrandContext();
  if (gateBrand) {
    const { gateCredits } = await import('$lib/server/credits');
    await gateCredits(gateBrand);
  }

  const spec = videoModelSpec(model);
  const input = buildTransformInput(model, opts.role, {
    prompt: opts.prompt,
    videoUrl: opts.videoUrl,
    imageUrl: opts.imageUrl,
    aspectRatio: opts.aspectRatio,
    mode: opts.mode
  });

  const t0 = Date.now();
  let job: VideoJobResult | undefined;
  try {
    job =
      spec?.endpoint === 'aleph'
        ? await runAlephJob(input, opts.abortSignal)
        : await (async () => {
            const taskId = await createKieTask(
              kieVideoModel(model, opts.role),
              input,
              opts.abortSignal,
              'video.transform'
            );
            return taskId
              ? pollKieTask(taskId, POLL_TIMEOUT_MS, opts.abortSignal, 'video.transform', POLL_INTERVAL_MS).then(
                  (r) => (r.status === 'done' ? r : undefined)
                )
              : undefined;
          })();
  } catch (e) {
    console.error('[video.transform] job failed', e);
  }

  logAiCall({
    label: `video.${opts.role}`,
    provider: 'kie',
    model,
    prompt: String(input.prompt ?? ''),
    ms: Date.now() - t0,
    ok: !!job,
    error: job ? undefined : 'no video returned',
    ...(job?.credits != null
      ? { providerCredits: job.credits, flatCostUsd: Math.round(job.credits * KIE_CREDIT_USD * 1e6) / 1e6 }
      : {}),
    context: opts.role
  });
  if (!job) return undefined;

  // Niente sottotitoli e niente taglio: la clip di partenza e\' gia\' montata, e rimontarla qui
  // sposterebbe il timing di quello che l\'utente ha approvato.
  const url = await persistMp4(opts.supabase, opts.userId, job.url, { captions: false, tighten: false });
  if (!url) return undefined;
  return { url, taskId: job.taskId, model };
}

/** A render kie has accepted but not finished. Everything here must survive the request. */
export type SubmittedVideoRender = {
  taskId: string;
  model: string;
  prompt: string;
  durationSeconds: number;
  resolution: string;
  coverUrl?: string;
  persistOpts: VideoPersistOpts;
  /** Epoch ms all'invio: è come il registro sa quanto la clip ha davvero impiegato. */
  submittedAt: number;
};

/**
 * Consegna il job a kie e si ferma. L'attesa che fa `renderVideo` non compra niente: il task id è
 * un appiglio durevole e il risultato resta recuperabile da qualunque processo — tenere aperta
 * un'invocazione a guardare la coda di qualcun altro è ciò che rendeva la generazione la cosa più
 * lunga del repo, e ciò che la limitava a POLL_TIMEOUT_MS comunque.
 *
 * I crediti si GATANO qui ma non si fatturano: `creditsConsumed` esatto arriva solo col job finito,
 * quindi l'addebito cade in `finishVideoRender` e un job che non riesce non si paga.
 */
export async function submitVideoRender(
  imagePrompt: string,
  opts: RenderVideoOpts = {}
): Promise<SubmittedVideoRender | undefined> {
  const p = await prepareVideoRender(imagePrompt, opts);

  // Same contract as the inline path: a kie or network failure is non-fatal and returns undefined
  // so the caller ships the cover. Without this a blip unwinds into the caller's outer catch and
  // takes the whole post with it — including the cover image already generated and paid for.
  // CreditsExhaustedError is re-thrown: that is a message for the user, not a render failure.
  const endpoint = videoEndpoint(p.model, {
    hasRefs:
      p.referenceVideoUrls.length > 0 || p.referenceAudioUrls.length > 0 || p.referenceImageUrls.length > 0
  });

  let taskId: string | undefined;
  try {
    if (endpoint === 'openrouter') {
      // Si INVIA e basta: il poll lo fara' il riconciliatore, sullo stesso id, quante volte serve.
      const out = await submitOpenrouterVideo(
        {
          model: p.model,
          prompt: p.prompt,
          durationSeconds: p.durationSeconds,
          resolution: p.resolution,
          aspectRatio: p.aspectRatio,
          imageUrl: p.cover,
          lastFrameUrl: p.lastFrame
        },
        opts.abortSignal
      );
      if (!out.jobId) {
        // Il motivo esisteva gia' qui e moriva nel log: chi ha chiamato il tool riceveva
        // `render_failed` nudo e non poteva sapere se riprovare o cambiare parametro.
        console.error(`[video] submit openrouter rifiutato: ${out.error}`);
        if (out.error) opts.onSubmitError?.(String(out.error));
        return undefined;
      }
      return {
        taskId: tagOpenrouterJob(out.jobId),
        model: p.model,
        prompt: p.prompt,
        durationSeconds: p.durationSeconds,
        resolution: p.resolution,
        coverUrl: p.cover,
        persistOpts: p.persistOpts,
        submittedAt: Date.now()
      };
    }
    taskId = await createKieTask(
      p.model,
      buildJobInput(p.model, {
        prompt: p.prompt,
        durationSeconds: p.durationSeconds,
        resolution: p.resolution,
        aspectRatio: p.aspectRatio,
        imageUrl: p.cover,
        hasScript: !!p.script,
        lastFrameUrl: p.lastFrame,
        referenceVideoUrls: p.referenceVideoUrls,
        referenceAudioUrls: p.referenceAudioUrls,
        referenceImageUrls: p.referenceImageUrls
      }),
      opts.abortSignal
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'CreditsExhaustedError') throw e;
    const why = e instanceof Error ? e.message : String(e);
    console.error('[video] submit failed:', why);
    opts.onSubmitError?.(why);
    return undefined;
  }
  if (!taskId) {
    opts.onSubmitError?.('the provider accepted no task for this request');
    return undefined;
  }

  return {
    taskId,
    model: p.model,
    prompt: p.prompt,
    durationSeconds: p.durationSeconds,
    resolution: p.resolution,
    coverUrl: p.cover,
    persistOpts: p.persistOpts,
    submittedAt: Date.now()
  };
}

export type VideoRenderOutcome =
  /** kie is still working. Ask again later; nothing is held open in the meantime. */
  | { status: 'pending' }
  | { status: 'done'; url: string; durationSeconds: number; resolution: string; thumbnailUrl?: string }
  | { status: 'failed'; error: string };

export function videoTaskProvider(taskId: string): 'openrouter' | 'kie' {
  return untagOpenrouterJob(taskId) ? 'openrouter' : 'kie';
}

/**
 * Check a submitted render once, and finish it if kie is done.
 *
 * One `recordInfo` call — no loop, no sleep, no budget. That is the whole point: the caller can be
 * a cron tick costing milliseconds instead of a process sitting on a ten-minute timer.
 */
export async function finishVideoRender(
  supabase: SupabaseClient,
  userId: string,
  submitted: SubmittedVideoRender
): Promise<VideoRenderOutcome> {
  // CHI interrogare lo dice la RIGA, non `AI_ROUTE_VIDEO` di adesso: una clip consegnata prima di
  // un deploy che sposta la variabile deve restare recuperabile da chi l'ha presa in carico.
  const openrouterJobId = untagOpenrouterJob(submitted.taskId);
  if (openrouterJobId) return finishOpenrouterRender(supabase, userId, submitted, openrouterJobId);

  if (!env.KIE_API_KEY) throw new Error('KIE_API_KEY not configured');

  const res = await fetch(
    `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(submitted.taskId)}`,
    { headers: authHeaders(), signal: AbortSignal.timeout(30_000) }
  );
  // A transient 5xx is not a failed render — the task is still kie's, so stay pending and retry.
  if (!res.ok) return { status: 'pending' };

  const info = await res.json();
  const state = info?.data?.state;
  if (state === 'fail' || state === 'failed' || state === 'error') {
    return { status: 'failed', error: String(info?.data?.failMsg ?? 'kie reported a failed render') };
  }
  if (state !== 'success' && state !== 'completed') return { status: 'pending' };

  const raw = info?.data?.resultJson;
  let parsed: { resultUrls?: string[] } | undefined;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { status: 'failed', error: 'kie returned an unreadable result payload' };
  }
  const sourceUrl = parsed?.resultUrls?.[0];
  if (!sourceUrl) return { status: 'failed', error: 'kie reported success with no clip url' };

  // Store FIRST, bill second. persistMp4 downloads from kie and can throw, and the caller hands a
  // thrown row back to a per-minute cron — so billing above this line would charge the same clip
  // again on every retry until the give-up window closed.
  const url = await persistMp4(supabase, userId, sourceUrl, submitted.persistOpts);
  if (!url) return { status: 'failed', error: 'clip rendered but could not be stored' };

  // Bill here, not at submit: this is the first point kie states its exact charge, and a render
  // that never succeeds is never billed — the same contract the inline path has always had.
  const rawCredits = info?.data?.creditsConsumed ?? info?.data?.credits_consumed;
  const credits = Number.isFinite(Number(rawCredits)) ? Number(rawCredits) : undefined;
  logAiCall({
    label: 'video.render',
    provider: 'kie',
    model: submitted.model,
    prompt: submitted.prompt,
    // Wall time from submit to landing — what the clip actually took, queue included. The inline
    // path could only ever measure its own blocked wait, which is the same number by accident.
    ms: Math.max(0, Date.now() - submitted.submittedAt),
    ok: true,
    ...(credits != null
      ? { providerCredits: credits, flatCostUsd: Math.round(credits * KIE_CREDIT_USD * 1e6) / 1e6 }
      : {}),
    context: `${submitted.durationSeconds}s ${submitted.resolution} (async)`
  });

  return {
    status: 'done',
    url,
    durationSeconds: submitted.durationSeconds,
    resolution: submitted.resolution,
    thumbnailUrl: submitted.coverUrl
  };
}

/**
 * L'altra meta' di `finishVideoRender`, per i job che vivono su OpenRouter.
 *
 * Una interrogazione sola, mai un ciclo: `pending` vuol dire "richiedi al giro dopo", e nessun
 * secondo invio parte da qui — il job e' gia' del fornitore, e riaprirlo lo pagherebbe due volte.
 */
async function finishOpenrouterRender(
  supabase: SupabaseClient,
  userId: string,
  submitted: SubmittedVideoRender,
  jobId: string
): Promise<VideoRenderOutcome> {
  const outcome = await checkOpenrouterVideo(jobId);
  if (outcome.status === 'pending') return { status: 'pending' };
  if (outcome.status === 'failed') return { status: 'failed', error: outcome.error };
  if (outcome.status === 'timeout') return { status: 'pending' };

  // Si RIOSPITA prima e si fattura dopo: il download puo' fallire, e chi ci richiama e' un cron.
  const url = await persistMp4(supabase, userId, outcome.url, {
    ...submitted.persistOpts,
    headers: openrouterVideoHeaders()
  });
  if (!url) return { status: 'failed', error: 'clip rendered but could not be stored' };

  logAiCall({
    label: 'video.render',
    provider: 'openrouter',
    model: openrouterVideoModel(submitted.model) ?? submitted.model,
    prompt: submitted.prompt,
    ms: Math.max(0, Date.now() - submitted.submittedAt),
    ok: true,
    // Ignoto non e' zero: se OpenRouter non riporta il costo, la riga lo dice invece di inventarlo.
    ...(outcome.costUsd != null ? { flatCostUsd: outcome.costUsd } : {}),
    context: `${submitted.durationSeconds}s ${submitted.resolution} (async) · job ${jobId}`
  });

  return {
    status: 'done',
    url,
    durationSeconds: submitted.durationSeconds,
    resolution: submitted.resolution,
    thumbnailUrl: submitted.coverUrl
  };
}

// Re-render an ALREADY GENERATED clip at a higher resolution, without paying to generate it again.
// kie's upscale takes the original job's task_id (never a URL), which is exactly why renderVideo
// hands the id back and the post row keeps it.
//
// This is the second half of the cost strategy: drafts render at RESOLUTION (cheap), and only the
// clips a user actually approves are upscaled. Most drafts are never published, so the expensive
// resolution is paid on a fraction of them.
//
// Returns undefined on ANY failure — no task id, provider refusal, timeout, storage error — and
// the caller keeps publishing the draft-resolution clip. A worse pixel count must never cost a post.
// Note kie documents the id as needing to come from "a Kie AI video generation model": whether an
// id minted by a NON-Grok model (e.g. Seedance) is accepted here is not stated, so a rejection is
// treated as an ordinary miss rather than something to assert about up front.
export async function upscaleVideo(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  resolution: string = UPSCALE_RESOLUTION
): Promise<{ url: string; resolution: string } | undefined> {
  if (!env.KIE_API_KEY || !taskId) return undefined;

  // L'upscale di kie prende un task_id DI KIE. Un id di OpenRouter qui otterrebbe un 404 dopo un
  // giro di rete, e nel caso peggiore l'id di qualcun altro.
  if (untagOpenrouterJob(taskId)) return undefined;

  // Upscale is a Grok-Imagine endpoint that takes a Grok task_id. Seedance (and unknown) drafts
  // have no matching upscale path — skip rather than burn a round-trip that will fail.
  if (!videoModelCaps(envModelI2V()).supportsUpscale) return undefined;

  // Same runaway-spend gate as generation: an exhausted brand must not buy pixels either.
  const gateBrand = getBrandContext();
  if (gateBrand) {
    try {
      const { gateCredits } = await import('$lib/server/credits');
      await gateCredits(gateBrand);
    } catch {
      // Unlike generation, an exhausted quota here is NOT worth failing the publish over — the
      // draft-resolution clip is already a complete, publishable post. Degrade silently.
      return undefined;
    }
  }

  const t0 = Date.now();
  try {
    const newTaskId = await createKieTask(MODEL_UPSCALE, { task_id: taskId, resolution }, undefined, 'video');
    const polled = newTaskId
      ? await pollKieTask(newTaskId, UPSCALE_TIMEOUT_MS, undefined, 'video', POLL_INTERVAL_MS)
      : undefined;
    const job = polled?.status === 'done' ? polled : undefined;
    logAiCall({
      label: 'video.upscale',
      provider: 'kie',
      model: MODEL_UPSCALE,
      ms: Date.now() - t0,
      ok: !!job,
      error: job ? undefined : 'no upscaled video returned',
      ...(job?.credits != null
        ? { providerCredits: job.credits, flatCostUsd: Math.round(job.credits * KIE_CREDIT_USD * 1e6) / 1e6 }
        : {}),
      context: `${resolution} from ${taskId.slice(0, 24)}`
    });
    if (!job) return undefined;

    const url = await persistMp4(supabase, userId, job.url);
    return url ? { url, resolution } : undefined;
  } catch {
    return undefined;
  }
}
