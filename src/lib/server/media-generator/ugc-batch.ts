/**
 * UGC Creator batch runner — N talking clips (≤20) with product redistribution
 * and bounded parallelism so a 20-pack does not wait fully sequential.
 */
import { swallow } from '$lib/server/swallow';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import type { GoogleGenAI } from '@google/genai';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { fetchImagePart } from '$lib/server/brand-context';
import { logAiCall, withBrandContext } from '$lib/server/ai-log';
import {
  renderPostImage,
  uploadPostImage,
  type AspectRatio
} from '$lib/server/content-preview';
import { CHAT_USER_ERROR } from '$lib/server/chat/report-error';
import {
  UGC_CAPTURE_RULES,
  UGC_COVER_MODEL,
  UGC_VISUAL_STYLE,
  buildUgcCastPortraitPrompt,
  buildUgcFramePrompt,
  buildUgcProductStillPrompt,
  buildUgcShotBrief,
  buildUgcStoryboardFrames,
  formatUgcShotBrief,
  ugcSpokenLine,
  type UgcScript
} from '$lib/server/ugc';
import { UGC_MAX_DURATION } from '$lib/server/video';
import { deleteMediaGeneratorItem, insertMediaGeneratorItem } from '$lib/server/media-generator/persist';
import {
  compactReviewForTool,
  formatReviewApplyBrief,
  reviewNeedsRewrite,
  scoreFinishedClip,
  VIDEO_QC_REMAKE_MAX
} from '$lib/server/video-review-apply';
import {
  formatUgcBrandGrounding,
  loadUgcBrandGrounding,
  type UgcBrandGrounding
} from '$lib/server/media-generator/brand-grounding';
import { planUgcClipsWithTools } from '$lib/server/media-generator/ugc-plan-agent';
import {
  formatIsMultiScene,
  isUgcFormatId,
  platformClipSeconds,
  rotateUgcFormats,
  ugcFormatById,
  ugcPlatformBrief,
  type UgcFormatId,
  type UgcPlatformId
} from '$lib/ugc-formats';
import { disruptiveBriefSection } from '$lib/disruptive';
import { aiStructured } from '$lib/server/xiaomi';
import { trendingWallDigestSection } from '$lib/server/wall-digest';
import { isSeedanceFamily, SEEDANCE_25_MODEL } from '$lib/video-models';
import {
  DESIGNER_SLICE_RESERVE_MS,
  truncatedDesignerNotice
} from '$lib/server/designer-jobs';
import type { ChatTurnDeadline } from '$lib/server/chat/turn-limits';
import { runUgcOrchestrator } from '$lib/server/media-generator/ugc-agent';

export const UGC_BATCH_MAX = 20;
/** How many clips render at once — enough to cut wall-clock without melting kie/Gemini. */
export const UGC_BATCH_CONCURRENCY = 4;
/**
 * Quanti frame di scena rendere OLTRE alla cover, sui formati che cambiano davvero inquadratura.
 * Uno per stacco: uno storyboard che si ferma a metà lascia gli ultimi shot senza riferimento, ed
 * è esattamente lì che il modello inventa un'altra persona o un'altra stanza. Il tetto esiste
 * perché ogni frame è una resa Nano Banana Pro e un batch da venti clip lo moltiplica per venti.
 */
export const UGC_SCENE_REFERENCE_FRAMES = 4;
/**
 * Quante immagini di riferimento spedire con una resa Seedance.
 *
 * NON è un limite dell'API, e vale la pena scriverlo perché per mezz'ora l'ho creduto: una resa era
 * stata rifiutata con sei reference e ne avevo dedotto un tetto di cinque. Sondando `createTask`
 * direttamente, sei reference vengono ACCETTATE (e anche con durata 15 e audio attivo). Quel
 * rifiuto aveva un'altra causa, che il log del corpo dell'errore adesso rende leggibile.
 *
 * Sei è quello che la nostra pipeline produce al massimo — fotogramma d'apertura, volto, quattro
 * scene — nell'ordine che conta: le eccedenti si taglierebbero dal fondo, dove pesano meno.
 */
export const UGC_VIDEO_REFERENCE_MAX = 6;

export type UgcProductRef = {
  id: string;
  name: string;
  urls: string[];
};

/** AI talent / model face refs — redistributed like products across the batch. */
export type UgcModelRef = {
  id: string;
  name: string;
  urls: string[];
};

export type UgcBatchOpts = {
  /**
   * Il thread aperto da `openSurfaceTurn` per questo giro. Serve all'orchestratore: obiettivo e
   * artefatti appartengono a una conversazione, e senza thread quei tool rifiutano ogni chiamata.
   * La route lo mette già negli `inputParams` della continuazione — non arrivava fin qui.
   */
  threadId?: string | null;
  supabase: SupabaseClient;
  userId: string;
  brandId: string;
  prompt: string;
  videoCount: number;
  /** Products to redistribute across the batch (block-proportional). */
  products?: UgcProductRef[];
  /** AI talents/models to redistribute across the batch (block-proportional). */
  models?: UgcModelRef[];
  /** Shared refs (uploads, brand people, thumbs) applied to every clip — not talents/products. */
  referenceUrls?: string[];
  /**
   * Existing grid videos to remake / motion-transfer (Seedance reference_video_urls).
   * When set, clips use Seedance multimodal refs instead of inventing a cover from scratch.
   */
  referenceVideoUrls?: string[];
  /** Seedance start-frame still (public https or data:image). */
  firstFrameUrl?: string | null;
  /** Seedance end-frame still. */
  lastFrameUrl?: string | null;
  /** Seedance reference audio URLs (public https). */
  referenceAudioUrls?: string[];
  aspectRatio?: AspectRatio;
  /**
   * Ad format for the whole batch. Unset → the batch ROTATES formats across slots, which is the
   * point: ten clips in one format are ten paraphrases, whatever the scripts say.
   */
  format?: UgcFormatId | null;
  /** Destination platform — decides native formats and the clip length inside the model's cap. */
  platform?: UgcPlatformId | null;
  useBrandStyle?: boolean;
  promptId?: string | null;
  abortSignal?: AbortSignal;
  videoModel?: string | null;
  /** Soft Vercel budget — skip starting new clips when the slice is too short. */
  deadline?: ChatTurnDeadline;
  locale?: string;
  /** Skip the planner and render these clips (continuation job). */
  resumePlans?: UgcClipPlan[];
  onTruncated?: (remaining: UgcClipPlan[]) => void | Promise<void>;
  consumeSseStream?: (args: { stream: ReadableStream<string | Uint8Array> }) => Promise<void>;
};

function httpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const u = raw.trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

function stillUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const u = raw.trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u) || u.startsWith('data:image/')) return u;
  return null;
}

/** Normalize Seedance materials for a UGC batch (exported for tests). */
export function resolveUgcSeedanceMaterials(opts: {
  referenceVideoUrls?: string[] | null;
  referenceAudioUrls?: string[] | null;
  firstFrameUrl?: string | null;
  lastFrameUrl?: string | null;
}): {
  refVideos: string[];
  refAudios: string[];
  firstFrame: string | null;
  lastFrame: string | null;
  skipGeneratedCover: boolean;
} {
  const refVideos = (opts.referenceVideoUrls ?? [])
    .map(httpUrl)
    .filter((u): u is string => !!u)
    .slice(0, 10);
  const refAudios = (opts.referenceAudioUrls ?? [])
    .map(httpUrl)
    .filter((u): u is string => !!u)
    .slice(0, 10);
  const firstFrame = stillUrl(opts.firstFrameUrl);
  const lastFrame = stillUrl(opts.lastFrameUrl);
  return {
    refVideos,
    refAudios,
    firstFrame,
    lastFrame,
    skipGeneratedCover: refVideos.length > 0 || !!firstFrame || refAudios.length > 0
  };
}

/**
 * Block-proportional assignment: 10 slots + 2 items → 5+5; 5 + 2 → 3+2.
 * Empty list → every slot gets null.
 */
export function distributeSlots<T>(count: number, items: T[]): (T | null)[] {
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) return [];
  if (!items.length) return Array.from({ length: n }, () => null);
  return Array.from({ length: n }, (_, i) => {
    const idx = Math.min(items.length - 1, Math.floor((i * items.length) / n));
    return items[idx] ?? null;
  });
}

/** @deprecated use {@link distributeSlots} */
export const distributeProducts = distributeSlots;

export function clampUgcVideoCount(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(UGC_BATCH_MAX, Math.max(1, Math.round(v)));
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  abortSignal?: AbortSignal
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      if (abortSignal?.aborted) return;
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

export type UgcClipPlan = {
  index: number;
  product: UgcProductRef | null;
  model: UgcModelRef | null;
  script: UgcScript;
  setting: string;
  /** The format this clip runs in — travels into the shot brief and into a resumed job. */
  format?: UgcFormatId | null;
  /** What happens on screen in second one (the planner's, not derived from the spoken hook). */
  hookVisual?: string | null;
};

type ClipPlan = UgcClipPlan;

function cleanEntityRefs(
  raw: UgcProductRef[] | UgcModelRef[] | undefined
): UgcProductRef[] {
  return (raw ?? [])
    .filter((p) => p && typeof p.id === 'string' && Array.isArray(p.urls) && p.urls.length)
    .slice(0, UGC_BATCH_MAX)
    .map((p) => ({
      id: p.id,
      name: (p.name || 'ref').trim().slice(0, 120),
      urls: p.urls
        .filter(
          (u) =>
            typeof u === 'string' &&
            (/^https?:\/\//i.test(u) || u.startsWith('data:image/'))
        )
        .slice(0, 4)
    }))
    .filter((p) => p.urls.length > 0);
}

/** Exported for tests — builds the planner user prompt with brand grounding. */
export function buildUgcBatchPlanPrompt(opts: {
  count: number;
  prompt: string;
  productAssignments: (UgcProductRef | null)[];
  modelAssignments: (UgcModelRef | null)[];
  brand: UgcBrandGrounding;
  formatPlan?: UgcFormatId[];
  platform?: UgcPlatformId | null;
}): string {
  const { count, prompt, productAssignments, modelAssignments, brand } = opts;
  const brandName = brand.name || 'the brand';
  const formatPlan = opts.formatPlan ?? [];
  const assignmentLines = buildAssignmentLines(
    count,
    productAssignments,
    modelAssignments,
    brandName,
    formatPlan
  );
  const langRule = brand.language
    ? `- LANGUAGE: write every spoken line in ${brand.language} (natural spoken register, not translated ad copy).`
    : `- LANGUAGE: match the user brief's language (if the brief is Italian, scripts are Italian).`;

  return `Write ${count} DISTINCT concise PAS spoken scripts for UGC talking-head videos (≤15s each, ~40–48 words total per clip).

${formatUgcBrandGrounding(brand)}

User brief (topic bible — follow this; do not drift to unrelated life stories):
${prompt.trim()}

Clip assignments:
${assignmentLines}

Rules:
- Each clip must feel like a different take (angle, brand-relevant pain, feature, setting) — not paraphrases of the same line.
- Full spoken sentences, personal and emotional — not telegram fragments or ad slogans.
- Hook = a REAL pain THIS brand's audience has (from category/about/offerings/brief). Body = cost + how ${brandName} (or assigned product) fixes it with ONE concrete feature/mechanic + one proof. CTA = soft afterthought.
- When a product is assigned, name it naturally in the SOLUTION beat. When none is assigned, name "${brandName}" and a real feature from the brief/offerings.
- When a speaker/model is assigned, write as that person talking (first person) — do not describe their looks in the script.
- Keep every script short enough to finish in 15 seconds.
- Each clip runs the FORMAT assigned to its slot: the format decides what happens on screen (an unboxing opens on a package, a comparison spends a third of the clip on the old way), so the words have to fit that, not a single fixed arc.
- hook_visual on every clip: what is physically happening in second one, saying something the spoken hook does not.
${langRule}

${UGC_CAPTURE_RULES}

${ugcPlatformBrief(opts.platform)}

${disruptiveBriefSection()}
Mark the disruptive clip of the batch by naming its lever in hook_visual (e.g. "destroy_the_alternative: …").`;
}

export function buildAssignmentLines(
  count: number,
  productAssignments: (UgcProductRef | null)[],
  modelAssignments: (UgcModelRef | null)[],
  brandName = 'the brand',
  /** Format per slot. The rotation is what stops a batch from being one clip rendered ten times. */
  formatPlan: UgcFormatId[] = []
): string {
  return Array.from({ length: count }, (_, i) => {
    const product = productAssignments[i];
    const model = modelAssignments[i];
    const format = formatPlan[i];
    const bits = [
      product ? `product "${product.name}"` : `feature ${brandName} (no specific product pick)`,
      model ? `speaker/model "${model.name}"` : 'invent a concrete speaker look',
      format ? `format ${format}` : null
    ].filter(Boolean);
    return `#${i + 1}: ${bits.join('; ')}`;
  }).join('\n');
}

function clipsToPlans(
  count: number,
  productAssignments: (UgcProductRef | null)[],
  modelAssignments: (UgcModelRef | null)[],
  brand: UgcBrandGrounding,
  clips: Array<{
    hook?: string;
    body?: string;
    cta?: string;
    setting?: string;
    feature?: string;
    format?: string;
    hookVisual?: string;
  }>,
  formatPlan: UgcFormatId[] = []
): ClipPlan[] {
  const brandName = brand.name || 'the brand';
  const fallbackHook = brand.category
    ? `I was drowning in ${brand.category.toLowerCase()} busywork every week.`
    : `I kept doing the ${brandName} work the hard way every night.`;
  return Array.from({ length: count }, (_, index) => {
    const product = productAssignments[index] ?? null;
    const model = modelAssignments[index] ?? null;
    const row = clips[index];
    const solutionName = product?.name || row?.feature || brandName;
    const script: UgcScript = {
      hook: (row?.hook ?? fallbackHook).trim(),
      body: (
        row?.body ??
        `It was eating my evenings — then ${solutionName} took the busywork off my plate.`
      ).trim(),
      cta: (row?.cta ?? 'Anyway try it and tell me I am wrong.').trim()
    };
    return {
      index,
      product,
      model,
      script,
      setting: (row?.setting ?? 'a lived-in room at home').trim(),
      // The planner's own pick wins; the rotation is the floor, so a slot is never format-less.
      format: isUgcFormatId(row?.format) ? row.format : (formatPlan[index] ?? null),
      hookVisual: row?.hookVisual?.trim() || null
    };
  });
}

/** One-shot fallback when the tool-using planner fails. */
async function planClipScriptsFallback(
  ai: GoogleGenAI,
  prompt: string,
  productAssignments: (UgcProductRef | null)[],
  modelAssignments: (UgcModelRef | null)[],
  brand: UgcBrandGrounding,
  formatPlan: UgcFormatId[] = [],
  platform: UgcPlatformId | null = null
): Promise<ClipPlan[]> {
  const count = productAssignments.length;

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      clips: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hook: {
              type: 'string',
              description:
                'Brand-relevant PROBLEM hook (~8–12 spoken words), personal, mid-conversation — NOT medical/family/unrelated life drama'
            },
            body: {
              type: 'string',
              description:
                'AGITATE + SOLUTION (~18–28 spoken words): one cost beat, then name the brand/product + one concrete feature/mechanic + one proof'
            },
            cta: {
              type: 'string',
              description: 'Soft CTA (~6–10 spoken words), afterthought — never a slogan'
            },
            setting: {
              type: 'string',
              description: 'Real room where they film (e.g. kitchen counter, bedroom desk, office desk)'
            },
            format: {
              type: 'string',
              description:
                'The ad format id assigned to this slot (problem_solution, testimonial, unboxing, tutorial, comparison, day_in_life, green_screen, tiktok_shop)'
            },
            hook_visual: {
              type: 'string',
              description:
                'What is physically HAPPENING in second one — must say something the spoken hook does not'
            }
          },
          required: ['hook', 'body', 'cta', 'setting', 'format', 'hook_visual']
        }
      }
    },
    required: ['clips']
  };

  type Planned = {
    clips: Array<{
      hook: string;
      body: string;
      cta: string;
      setting: string;
      format?: string;
      hook_visual?: string;
    }>;
  };

  let planned: Planned | null = null;
  try {
    planned = await aiStructured<Planned>(
      ai,
      // + il pavimento dal wall /trending (digest settimanale già distillato, niente AI qui;
      // stantio ⇒ stringa vuota). Stesso blocco che riceve il planner primario in ugc-plan-agent.
      buildUgcBatchPlanPrompt({
        count,
        prompt,
        productAssignments,
        modelAssignments,
        brand,
        formatPlan,
        platform
      }) + (await trendingWallDigestSection()),
      schema,
      `You write short, expressive spoken UGC scripts ABOUT the given brand only. Pain must be brand-category relevant. Never invent medical, family, relationship, or unrelated money-stress stories. Return only the structured clips array.`,
      'plan_ugc_batch',
      { temperature: 0.85 }
    );
  } catch (e) {
    console.error('[ugc-batch] script plan fallback failed', e);
  }

  return clipsToPlans(
    count,
    productAssignments,
    modelAssignments,
    brand,
    (planned?.clips ?? []).map((c) => ({ ...c, hookVisual: c.hook_visual })),
    formatPlan
  );
}

function genaiClient(): GoogleGenAI {
  // Dummy: renderPostImage costruisce Google da solo sul ripiego pixel.
  return null as unknown as GoogleGenAI;
}

/**
 * Stream a UGC batch as UI-message SSE (same event shapes the Media Generator client already folds).
 */
/**
 * UNA CLIP, ESTRATTA — perché l'agente possa renderne una alla volta.
 *
 * Questo corpo stava dentro la callback di `mapPool`: 483 righe che vedevano `writer`, `brand`,
 * `opts` e altre dieci variabili solo perché erano nello scope di chi le racchiudeva. Finché il
 * batch era una pipeline andava bene; da quando c'è un agente che decide QUALI clip rifare e
 * QUANDO, il rendering di una clip deve essere una cosa chiamabile.
 *
 * L'estrazione è deliberatamente stupida: il contesto si destruttura con **gli stessi nomi** che
 * il corpo usava, quindi il corpo non cambia di una riga. Un'estrazione che ne approfitta per
 * riscrivere è un'estrazione che non si può rivedere — e questo percorso non ha test, perché
 * `ugc-batch.test.ts` copre gli helper puri e non il render.
 */
export type UgcClipRunContext = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writer: any;
  textId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand: any;
  opts: UgcBatchOpts;
  aspect: AspectRatio;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  materials: any;
  announceClip: (fn: () => void) => Promise<void>;
  videoCount: number;
  remakeMode: boolean;
  refVideoUrls: string[];
  clipSeconds: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  platform: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai: any;
  finished: Set<number>;
  /**
   * Indice → PERCHÉ è fallita. Prima una clip fallita finiva dentro `finished` ("settled"), e
   * l'orchestratore — che legge `finished` come successo — la riportava `rendered`: `read_plan` la
   * mostrava uscita, `finish` la contava, e la guardia `already_rendered` bloccava per sempre il
   * retry. I due significati ora sono separati: `finished` = uscita DAVVERO, `failed` = fallita
   * con la ragione (che è anche ciò che distingue un fallimento da un rinvio per deadline, che non
   * scrive in nessuno dei due).
   */
  failed: Map<number, string>;
  baseSharedRefUrls: string[];
  sharedParts: Array<{ inlineData: { mimeType: string; data: string } }>;
  /**
   * `done` e `failed` erano due `let` dello scope esterno. Sono le uniche due righe del corpo che
   * l'estrazione ha dovuto toccare: un contatore non si passa per valore, e mentirsi con una copia
   * avrebbe fatto uscire il batch con "0 clip rese" mentre le rendeva tutte.
   */
  tally: { done: number; failed: number };
};

export async function runOneUgcClip(ctx: UgcClipRunContext, plan: UgcClipPlan): Promise<void> {
  const {
    writer,
    textId,
    brand,
    opts,
    aspect,
    materials,
    announceClip,
    videoCount,
    remakeMode,
    refVideoUrls,
    clipSeconds,
    platform,
    ai,
    finished,
    failed,
    baseSharedRefUrls,
    sharedParts,
    tally
  } = ctx;
    if (opts.abortSignal?.aborted) return;
    if (opts.deadline && opts.deadline.remainingMs() < DESIGNER_SLICE_RESERVE_MS) {
      return;
    }
    const toolCallId = `ugc-clip-${plan.index + 1}-${Date.now()}`;
    const slotLabel = [plan.model?.name, plan.product?.name].filter(Boolean).join(' · ');
    await announceClip(() => {
      writer.write({
        type: 'text-delta',
        id: textId,
        delta: `Rendering clip ${plan.index + 1}/${videoCount}${
          slotLabel ? ` · ${slotLabel}` : ''
        }…\n`
      });
      writer.write({
        type: 'tool-input-start',
        toolCallId,
        toolName: 'generate_video'
      });
    });

    try {
      const productParts = (
        await Promise.all(
          (plan.product?.urls ?? []).slice(0, 2).map((u) => fetchImagePart(u))
        )
      ).filter(Boolean) as Array<{ inlineData: { mimeType: string; data: string } }>;

      const modelParts = (
        await Promise.all(
          (plan.model?.urls ?? []).slice(0, 3).map((u) => fetchImagePart(u))
        )
      ).filter(Boolean) as Array<{ inlineData: { mimeType: string; data: string } }>;

      const spoken = ugcSpokenLine(plan.script, clipSeconds);
      const productName = plan.product?.name || brand.name || undefined;

      /**
       * IL CASTING, PRIMA DI OGNI FRAME.
       *
       * Rendere lo storyboard scena per scena dallo stesso testo non dà lo stesso film: ne
       * dà cinque. Il prompt dice "inventa una persona vera e restaci coerente", e Nano
       * Banana la inventa da capo ogni volta — faccia diversa, prodotto diverso, stanza
       * diversa. La coerenza fra i frame non è una proprietà del testo, è una proprietà
       * delle IMMAGINI che il testo si porta dietro.
       *
       * Quindi: un ritratto della persona e uno still del prodotto PRIMA, e quelle due
       * immagini entrano come reference in ogni frame successivo e nella cover. Se il brand
       * ha già un talent o le foto del prodotto non si genera niente — una foto vera vale
       * più di un ritratto inventato.
       */
      const castParts: Array<{ inlineData: { mimeType: string; data: string } }> = [
        ...modelParts
      ];
      const castUrls: string[] = [];
      const needsCastPortrait =
        !modelParts.length && !materials.skipGeneratedCover && !remakeMode;
      if (needsCastPortrait) {
        try {
          const portraitPrompt = buildUgcCastPortraitPrompt({ setting: plan.setting });
          const portraitData = await renderPostImage(ai, portraitPrompt, {
            visualStyle: UGC_VISUAL_STYLE,
            model: UGC_COVER_MODEL,
            aspectRatio: aspect === '16:9' ? '16:9' : '9:16'
          });
          const portraitUrl = portraitData
            ? await uploadPostImage(opts.supabase, opts.userId, portraitData)
            : null;
          if (portraitUrl) {
            castUrls.push(portraitUrl);
            const part = await fetchImagePart(portraitUrl);
            if (part) castParts.push(part);
            await insertMediaGeneratorItem(opts.supabase, {
              brandId: opts.brandId,
              userId: opts.userId,
              promptId: opts.promptId,
              kind: 'image',
              url: portraitUrl,
              prompt: portraitPrompt,
              aspect,
              ugc: true
            });
          }
        } catch (e) {
          console.warn('[ugc-batch] cast portrait failed', e);
        }
      }

      // Lo still del prodotto solo quando un prodotto è assegnato e non ha foto proprie.
      const productStillParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
      if (plan.product?.name && !productParts.length && !remakeMode && !materials.skipGeneratedCover) {
        try {
          const stillPrompt = buildUgcProductStillPrompt(plan.product.name, {
            setting: plan.setting
          });
          const stillData = await renderPostImage(ai, stillPrompt, {
            model: UGC_COVER_MODEL,
            aspectRatio: aspect === '16:9' ? '16:9' : '9:16'
          });
          const stillUrl = stillData
            ? await uploadPostImage(opts.supabase, opts.userId, stillData)
            : null;
          if (stillUrl) {
            castUrls.push(stillUrl);
            const part = await fetchImagePart(stillUrl);
            if (part) productStillParts.push(part);
            await insertMediaGeneratorItem(opts.supabase, {
              brandId: opts.brandId,
              userId: opts.userId,
              promptId: opts.promptId,
              kind: 'image',
              url: stillUrl,
              prompt: stillPrompt,
              aspect,
              ugc: true
            });
          }
        } catch (e) {
          console.warn('[ugc-batch] product still failed', e);
        }
      }

      // Da qui in poi "la persona" esiste come immagine: la cover e ogni frame la ricevono.
      const hasPerson = castParts.length > 0;
      const sceneReferenceImages = [
        ...productParts,
        ...productStillParts,
        ...sharedParts
      ].slice(0, 4);
      // Il brief si serializza DOPO aver reso i frame: le REFERENCES devono dire cosa è
      // ogni immagine allegata, e prima di renderle non si sa quante sono.
      // La RESA passa dal secondo agente (tier pro, ugc-craft.ts): il deterministico è la
      // base e la rete — il crafter lo riscrive come farebbe un regista, o lo si ritrova.
      const briefFor = async (references: string[]) => {
        const base = buildUgcShotBrief({
          seconds: clipSeconds,
          hook: plan.script.hook,
          hookVisual: plan.hookVisual ?? undefined,
          format: plan.format ?? null,
          platform,
          product: productName,
          setting: plan.setting,
          person: hasPerson
            ? plan.model?.name || 'reference person'
            : undefined,
          desire: 'less chaos / get the work done / look competent'
        });
        const { craftUgcShotBrief } = await import('$lib/server/media-generator/ugc-craft');
        return craftUgcShotBrief({
          baseBrief: formatUgcShotBrief(base, { script: spoken, product: productName, references }),
          script: spoken,
          product: productName,
          references,
          platform,
          seconds: clipSeconds,
          hook: plan.script.hook,
          hookVisual: plan.hookVisual ?? undefined,
          setting: plan.setting,
          person: hasPerson ? plan.model?.name || 'reference person' : undefined,
          format: plan.format ?? null
        });
      };

      const { renderVideo, isKnownVideoModel } = await import('$lib/server/video');
      // UGC Creator defaults to Seedance 2.5. Remake from a selected grid video
      // requires Seedance (Kie reference_video_urls) — Grok Imagine cannot take video refs.
      let lockedModel =
        opts.videoModel && isKnownVideoModel(opts.videoModel)
          ? opts.videoModel
          : SEEDANCE_25_MODEL;
      if (
        (remakeMode || materials.refAudios.length || materials.firstFrame) &&
        !isSeedanceFamily(lockedModel)
      ) {
        lockedModel = SEEDANCE_25_MODEL;
      }
      const refForClip =
        remakeMode && refVideoUrls.length
          ? [refVideoUrls[plan.index % refVideoUrls.length]!]
          : [];
      const audioForClip = materials.refAudios.length
        ? [materials.refAudios[plan.index % materials.refAudios.length]!]
        : [];

      let coverUrl: string | undefined;
      if (materials.firstFrame && !remakeMode) {
        coverUrl = materials.firstFrame.startsWith('data:image/')
          ? ((await uploadPostImage(opts.supabase, opts.userId, materials.firstFrame)) ??
            undefined)
          : materials.firstFrame;
        if (!coverUrl) throw new Error('Start frame upload failed');
      } else if (!materials.skipGeneratedCover) {
        const framePrompt = buildUgcFramePrompt({
          product: plan.product?.name,
          hook: plan.script.hook,
          hookVisual: plan.hookVisual ?? undefined,
          setting: plan.setting,
          person: hasPerson
            ? plan.model?.name || 'the person in the reference photos'
            : undefined
        });

        const coverDataUrl = await renderPostImage(ai, framePrompt, {
          referenceImages: sceneReferenceImages.length ? sceneReferenceImages : undefined,
          referenceMode: productParts.length || productStillParts.length ? 'product' : undefined,
          personImages: hasPerson ? castParts.slice(0, 3) : undefined,
          visualStyle: UGC_VISUAL_STYLE,
          // Nano Banana PRO, come dice da sempre il commento su UGC_COVER_MODEL: il primo
          // frame porta l'identità dell'intera clip. Senza questa riga il batch cadeva sul
          // flash — il modello Pro lo usava solo il percorso dei post, non l'UGC Creator.
          model: UGC_COVER_MODEL,
          aspectRatio: aspect === '16:9' ? '16:9' : '9:16'
        });
        if (!coverDataUrl) throw new Error('Cover image failed');

        coverUrl = (await uploadPostImage(opts.supabase, opts.userId, coverDataUrl)) ?? undefined;
        if (!coverUrl) throw new Error('Cover upload failed');

        await insertMediaGeneratorItem(opts.supabase, {
          brandId: opts.brandId,
          userId: opts.userId,
          promptId: opts.promptId,
          kind: 'image',
          url: coverUrl,
          prompt: framePrompt,
          aspect,
          ugc: true
        }).catch(swallow('insertMediaGeneratorItem failed'));
      }

      /**
       * LE REFERENCE DEL VIDEO, NELL'ORDINE CHE CONTA.
       *
       * 1. IL VOLTO. Finora l'identità arrivava al modello video di seconda mano, dentro
       *    la cover: il ritratto del talent lo vedeva solo Nano Banana. Passarlo come
       *    reference esplicita è quello che tiene la faccia uguale per tutta la clip.
       * 2. I FRAME DELLE SCENE, e solo dove servono. Su un talking head in ripresa unica
       *    frame in più invitano a stacchi che il formato non vuole; su unboxing,
       *    confronto o tutorial la scena cambia davvero e il frame dice COME. Due al
       *    massimo oltre alla cover: ogni frame è una resa Nano Banana Pro, e un batch da
       *    dieci clip moltiplica per dieci.
       */
      const sceneRefUrls: string[] = [];
      if (!remakeMode && formatIsMultiScene(plan.format)) {
        const frames = buildUgcStoryboardFrames({
          seconds: clipSeconds,
          format: plan.format ?? null,
          hook: plan.script.hook,
          hookVisual: plan.hookVisual ?? undefined,
          product: productName,
          setting: plan.setting,
          person: hasPerson ? plan.model?.name || 'the person in the reference photos' : undefined
        })
          // La prima cella è la cover, già resa: si parte dalla seconda.
          .slice(1, 1 + UGC_SCENE_REFERENCE_FRAMES);
        // La cover è il primo shot: da qui in poi è essa stessa una reference, così la
        // stanza e la luce non cambiano fra uno shot e l'altro. Questa riga prima era solo
        // un commento — il codice passava i riferimenti generici e ogni frame usciva con
        // una persona e un prodotto diversi.
        const coverPart = coverUrl ? await fetchImagePart(coverUrl) : null;
        const frameSceneRefs = [
          ...(coverPart ? [coverPart] : []),
          ...sceneReferenceImages
        ].slice(0, 4);

        for (const frame of frames) {
          try {
            const dataUrl = await renderPostImage(ai, frame.prompt, {
              referenceImages: frameSceneRefs.length ? frameSceneRefs : undefined,
              referenceMode:
                productParts.length || productStillParts.length ? 'product' : undefined,
              // Il ritratto del casting (o le foto del talent) su OGNI frame: è l'unica
              // cosa che tiene la stessa faccia da uno shot al successivo.
              personImages: hasPerson ? castParts.slice(0, 3) : undefined,
              visualStyle: UGC_VISUAL_STYLE,
              model: UGC_COVER_MODEL,
              aspectRatio: aspect === '16:9' ? '16:9' : '9:16'
            });
            if (!dataUrl) continue;
            const url = await uploadPostImage(opts.supabase, opts.userId, dataUrl);
            if (!url) continue;
            sceneRefUrls.push(url);
            // Nella griglia, come la cover: uno storyboard che esiste solo dentro la
            // richiesta è invisibile, e all'utente sembra che sia stata fatta una immagine
            // sola per un video che cambia scena quattro volte.
            await insertMediaGeneratorItem(opts.supabase, {
              brandId: opts.brandId,
              userId: opts.userId,
              promptId: opts.promptId,
              kind: 'image',
              url,
              prompt: frame.prompt,
              aspect,
              ugc: true
            });
          } catch (e) {
            // Un frame di scena mancante degrada la resa, non la fa fallire: la cover c'è.
            console.warn('[ugc-batch] scene reference failed', e);
          }
        }
      }

      /**
       * L'ORDINE, E PERCHÉ LA COVER STA DAVANTI A TUTTO.
       *
       * Kie tratta first_frame e reference-to-video come MUTUAMENTE ESCLUSIVI: appena si
       * passa una reference image, `first_frame_url` non viene inviato. La prima versione
       * di questo blocco mandava volto + scene e faceva cadere la cover — cioè toglieva
       * l'ancoraggio più forte che avevamo, e la clip smetteva di somigliare al frame che
       * avevamo appena reso. Se si entra in modalità reference, la cover ci entra per
       * PRIMA: resta il fotogramma da cui la clip parte, e lo dice anche il prompt.
       */
      const videoRefImages = (
        sceneRefUrls.length || hasPerson
          ? [
              ...(coverUrl && /^https?:\/\//i.test(coverUrl) ? [coverUrl] : []),
              ...(plan.model?.urls ?? []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 2),
              ...castUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 2),
              ...sceneRefUrls
            ]
          : []
      ).slice(0, UGC_VIDEO_REFERENCE_MAX);

      const faceRefCount =
        (plan.model?.urls ?? []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 2).length +
        castUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 2).length;
      const coverIsRef = videoRefImages.length > 0 && videoRefImages[0] === coverUrl;
      const referenceLines = videoRefImages.length
        ? [
            ...(coverIsRef
              ? [
                  'is the OPENING FRAME: the clip starts exactly here — same person, same room, same wardrobe, same light.'
                ]
              : []),
            ...Array.from({ length: faceRefCount }, () =>
              `is the speaker: face, hair, build and wardrobe come from here and never change.`
            ),
            ...sceneRefUrls.map(
              (_u, i) =>
                `is SHOT ${i + 2} of this same clip — same person, same wardrobe, same room. It shows WHAT HAPPENS at that point, it is not a new character or a new place.`
            )
          ]
        : [];
      const shotBrief = await briefFor(referenceLines);
      const remakeBrief = remakeMode
        ? `${shotBrief}\n\nREMAKE:\n@Video1 is the selected clip to remake — keep identity, framing energy and UGC feel; apply the user brief changes; speak the new line exactly.`
        : shotBrief;

      const renderTake = async (brief: string, refVideos: string[]) => {
        const rendered = await renderVideo(opts.supabase, opts.userId, brief, {
          imageUrl: coverUrl,
          firstFrameUrl: coverUrl,
          lastFrameUrl: !remakeMode ? materials.lastFrame || undefined : undefined,
          aspectRatio: aspect === '16:9' ? '16:9' : '9:16',
          duration: clipSeconds,
          model: lockedModel,
          shotBrief: brief,
          ugc: true,
          script: spoken,
          referenceVideoUrls: refVideos.length ? refVideos : undefined,
          referenceImageUrls: videoRefImages.length ? videoRefImages : undefined,
          referenceAudioUrls: audioForClip.length ? audioForClip : undefined
        });
        if (!rendered?.url) throw new Error('Video render returned nothing');
        return rendered;
      };

      const persistClip = async (url: string, prompt: string) => {
        const saved = await insertMediaGeneratorItem(opts.supabase, {
          brandId: opts.brandId,
          userId: opts.userId,
          promptId: opts.promptId,
          kind: 'video',
          url,
          prompt,
          aspect,
          ugc: true
        });
        return 'row' in saved ? saved.row.id : undefined;
      };

      const scoreClip = async (url: string) =>
        scoreFinishedClip(opts.supabase, {
          brandId: opts.brandId,
          url,
          // Automatico: giudizio in linea che pilota il rifacimento della presa.
          auto: true,
          standard: 'organic',
          opts: {
            standard: 'organic',
            brandName: brand.name || null,
            product: plan.product?.name || null,
            script: spoken,
            language: brand.language || null,
            kind: 'video',
            abortSignal: opts.abortSignal
          }
        });

      let take = await renderTake(remakeBrief, refForClip);
      // Persist first so the grid shows the clip with a pending score ring
      // (calendar-style). persistReadyReview then overwrites pending → ready.
      let id = await persistClip(take.url, spoken);
      let qc = await scoreClip(take.url);

      writer.write({
        type: 'text-delta',
        id: textId,
        delta: qc.ok
          ? `Clip ${plan.index + 1} QC ${qc.review.overall}/10 · ${qc.review.verdict}.\n`
          : `Clip ${plan.index + 1} QC skipped (${qc.error}).\n`
      });

      if (qc.ok && reviewNeedsRewrite(qc.review)) {
        for (let attempt = 0; attempt < VIDEO_QC_REMAKE_MAX; attempt += 1) {
          if (opts.abortSignal?.aborted) throw new Error('Aborted');
          const applyBrief = `${remakeBrief}\n\n${formatReviewApplyBrief(qc.review, 'ugc')}`;
          writer.write({
            type: 'text-delta',
            id: textId,
            delta: `Clip ${plan.index + 1} insufficient — applying QC notes…\n`
          });
          try {
            const remade = await renderTake(applyBrief, [take.url, ...refForClip].slice(0, 10));
            const prevId = id;
            const remadeQc = await scoreClip(remade.url);
            const remadeId = await persistClip(remade.url, spoken);
            if (prevId) {
              await deleteMediaGeneratorItem(opts.supabase, opts.brandId, prevId).catch(swallow('delete replaced item'));
            }
            take = remade;
            id = remadeId;
            qc = remadeQc;
            writer.write({
              type: 'text-delta',
              id: textId,
              delta: remadeQc.ok
                ? `Clip ${plan.index + 1} remake QC ${remadeQc.review.overall}/10 · ${remadeQc.review.verdict}.\n`
                : `Clip ${plan.index + 1} remake ready (QC skipped).\n`
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[ugc-batch] clip ${plan.index + 1} QC remake failed`, msg);
            writer.write({
              type: 'text-delta',
              id: textId,
              delta: `Clip ${plan.index + 1} remake failed — keeping first take.\n`
            });
            break;
          }
          if (!qc.ok || !reviewNeedsRewrite(qc.review)) break;
        }
      }

      tally.done += 1;
      finished.add(plan.index);
      // Una ripresa riuscita cancella il fallimento precedente: la clip è fuori, punto.
      failed.delete(plan.index);
      writer.write({
        type: 'tool-output-available',
        toolCallId,
        output: {
          ok: true,
          type: 'video',
          url: take.url,
          prompt: spoken,
          id,
          coverImageUrl: coverUrl ?? take.thumbnailUrl ?? null,
          duration: take.durationSeconds,
          product: plan.product?.name ?? null,
          model: plan.model?.name ?? null,
          index: plan.index + 1,
          of: videoCount,
          remake: remakeMode,
          review: qc.ok ? compactReviewForTool(qc.review) : undefined
        }
      });
      writer.write({
        type: 'text-delta',
        id: textId,
        delta: `Clip ${plan.index + 1}/${videoCount} ready${remakeMode ? ' (remake)' : ''}.\n`
      });
    } catch (e) {
      tally.failed += 1;
      const aborted =
        opts.abortSignal?.aborted ||
        (e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message)));
      const msg = e instanceof Error ? e.message : String(e);
      // In `failed`, NON in `finished`: una clip fallita non è "uscita", è fallita con questa
      // ragione — e resta ritentabile dall'orchestratore (render_clip), mentre il fallback stupido
      // e la continuazione la trattano comunque come chiusa (vedi i filtri più sotto).
      if (!aborted) failed.set(plan.index, msg.slice(0, 300));
      console.error(`[ugc-batch] clip ${plan.index + 1} failed`, msg);
      writer.write({
        type: 'tool-output-error',
        toolCallId,
        errorText: msg
      });
      writer.write({
        type: 'text-delta',
        id: textId,
        delta: `Clip ${plan.index + 1} failed: ${msg}\n`
      });
    }
}

export function streamUgcBatchResponse(opts: UgcBatchOpts): Response {
  const videoCount = clampUgcVideoCount(opts.videoCount);
  const products = cleanEntityRefs(opts.products);
  const models = cleanEntityRefs(opts.models);
  const productAssignments = distributeSlots(videoCount, products);
  const modelAssignments = distributeSlots(videoCount, models);
  const platform = opts.platform ?? null;
  // No explicit format → rotate. That rotation is the whole reason a ten-pack stops looking like
  // one clip rendered ten times, so it happens here and not in the planner's discretion.
  const formatPlan = rotateUgcFormats(videoCount, {
    preferred: opts.format ?? null,
    platform
  });
  // The model's cap still rules; the platform only asks for something shorter inside it.
  const clipSeconds = platformClipSeconds(platform, UGC_MAX_DURATION);
  const aspect = (opts.aspectRatio === '16:9' ? '16:9' : '9:16') as AspectRatio;
  const baseSharedRefUrls = (opts.referenceUrls ?? [])
    .filter((u) => typeof u === 'string' && (u.startsWith('http') || u.startsWith('data:image/')))
    .slice(0, 4);
  const materials = resolveUgcSeedanceMaterials({
    referenceVideoUrls: opts.referenceVideoUrls,
    referenceAudioUrls: opts.referenceAudioUrls,
    firstFrameUrl: opts.firstFrameUrl,
    lastFrameUrl: opts.lastFrameUrl
  });
  const refVideoUrls = materials.refVideos;
  const remakeMode = refVideoUrls.length > 0;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      await withBrandContext(opts.brandId, async () => {
        const t0 = Date.now();
        const ai = genaiClient();
        const textId = `ugc-text-${Date.now()}`;
        writer.write({ type: 'text-start', id: textId });
        const planBits = [
          products.length
            ? `${products.length} product${products.length === 1 ? '' : 's'}`
            : null,
          models.length ? `${models.length} model${models.length === 1 ? '' : 's'}` : null,
          remakeMode
            ? `remake from ${refVideoUrls.length} reference video${refVideoUrls.length === 1 ? '' : 's'}`
            : null,
          materials.firstFrame ? 'start frame' : null,
          materials.lastFrame ? 'end frame' : null,
          materials.refAudios.length
            ? `${materials.refAudios.length} reference audio`
            : null
        ].filter(Boolean);
        writer.write({
          type: 'text-delta',
          id: textId,
          delta: opts.resumePlans?.length
            ? `Resuming ${opts.resumePlans.length} remaining UGC clip${opts.resumePlans.length === 1 ? '' : 's'}${
                planBits.length ? ` · ${planBits.join(' · ')}` : ''
              }…\n`
            : `Planning ${videoCount} UGC clip${videoCount === 1 ? '' : 's'}${
                planBits.length ? ` · ${planBits.join(' · ')}` : ''
              }…\n`
        });

        const brand = await loadUgcBrandGrounding(opts.supabase, opts.brandId).catch((e) => {
          console.error('[ugc-batch] brand grounding failed', e);
          return {
            name: 'Brand',
            about: '',
            category: '',
            audience: '',
            brandStyle: '',
            aiContext: '',
            offerings: [],
            language: ''
          } satisfies UgcBrandGrounding;
        });

        const assignmentLines = buildAssignmentLines(
          videoCount,
          productAssignments,
          modelAssignments,
          brand.name || 'the brand',
          formatPlan
        );

        let agentPlan: {
          clips: Array<{
            hook: string;
            body: string;
            cta: string;
            setting: string;
            format?: string;
            hookVisual?: string;
          }>;
          mediaUrls: string[];
          toolsUsed: string[];
        } = { clips: [], mediaUrls: [], toolsUsed: [] };
        let plans: ClipPlan[] = [];

        if (opts.resumePlans?.length) {
          plans = opts.resumePlans;
        } else {
          try {
          // Tool-using planner: chips fire when execute() starts, not after the whole step.
          agentPlan = await planUgcClipsWithTools({
            supabase: opts.supabase,
            brandId: opts.brandId,
            userId: opts.userId,
            prompt: opts.prompt,
            count: videoCount,
            assignmentLines,
            brand,
            platform,
            formatPlan,
            seconds: clipSeconds,
            abortSignal: opts.abortSignal,
            onToolStart: ({ toolCallId, toolName }) => {
              if (toolName.startsWith('read_')) {
                writer.write({
                  type: 'text-delta',
                  id: textId,
                  delta: `Read ${toolName.replace(/^read_/, '').replace(/_/g, ' ')}…\n`
                });
              } else if (toolName === 'submit_ugc_scripts') {
                writer.write({
                  type: 'text-delta',
                  id: textId,
                  delta: `Submitting ${videoCount} scripts…\n`
                });
              }
              writer.write({
                type: 'tool-input-start',
                toolCallId,
                toolName
              });
            },
            onTool: ({ toolCallId, input, output, errorText }) => {
              if (errorText) {
                writer.write({ type: 'tool-output-error', toolCallId, errorText });
              } else {
                writer.write({
                  type: 'tool-output-available',
                  toolCallId,
                  output: output ?? { ok: true, input }
                });
              }
            }
          });

          if (agentPlan.clips.length >= videoCount) {
            plans = clipsToPlans(
              videoCount,
              productAssignments,
              modelAssignments,
              brand,
              agentPlan.clips,
              formatPlan
            );
          } else {
            writer.write({
              type: 'text-delta',
              id: textId,
              delta: `Planner tools incomplete — falling back to structured scripts…\n`
            });
            const fallbackId = `ugc-plan-fallback-${Date.now()}`;
            writer.write({
              type: 'tool-input-start',
              toolCallId: fallbackId,
              toolName: 'plan_ugc_batch'
            });
            plans = await planClipScriptsFallback(
              ai,
              opts.prompt,
              productAssignments,
              modelAssignments,
              brand,
              formatPlan,
              platform
            );
            writer.write({
              type: 'tool-output-available',
              toolCallId: fallbackId,
              output: { ok: true, videoCount, planned: plans.length, fallback: true }
            });
          }
          } catch (e) {
            const aborted =
              opts.abortSignal?.aborted ||
              (e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message)));
            const timedOut = opts.deadline
              ? (opts.deadline.reached(), opts.deadline.expired)
              : false;
            if (!aborted && !timedOut) throw e;
          }
        }

        const tally = { done: 0, failed: 0 };

        // Screenshots / UI from read_media → shared product-like refs on every clip.
        if (!plans.length) {
          const remaining: ClipPlan[] = [];
          const timedOut = opts.deadline
            ? (opts.deadline.reached(), opts.deadline.expired)
            : false;
          const aborted = !!opts.abortSignal?.aborted;
          if (timedOut || aborted) {
            const locale = bilingualNoticeLocale(opts.locale);
            writer.write({
              type: 'text-delta',
              id: textId,
              delta: truncatedDesignerNotice(locale, true)
            });
            await opts.onTruncated?.(remaining);
          }
        } else {
        const sharedRefUrls = [
          ...baseSharedRefUrls,
          ...agentPlan.mediaUrls.filter(
            (u) => typeof u === 'string' && (u.startsWith('http') || u.startsWith('data:image/'))
          )
        ].slice(0, 4);

        const sharedParts = (
          await Promise.all(sharedRefUrls.map((u) => fetchImagePart(u)))
        ).filter(Boolean) as Array<{ inlineData: { mimeType: string; data: string } }>;

        writer.write({
          type: 'text-delta',
          id: textId,
          delta: opts.resumePlans?.length
            ? `Rendering remaining clips…\n`
            : `Scripts ready${
                agentPlan.toolsUsed.length ? ` (via ${agentPlan.toolsUsed.join(' → ')})` : ''
              }${sharedRefUrls.length ? ` · ${sharedRefUrls.length} media ref(s)` : ''}. Rendering…\n`
        });

        const finished = new Set<number>();
        /** Indice → ragione. Il canale dei fallimenti, separato da `finished` (vedi il tipo). */
        const failed = new Map<number, string>();
        let announce = Promise.resolve();
        const announceClip = (fn: () => void) => {
          announce = announce.then(() => fn()).catch(swallow('fn failed'));
          return announce;
        };

        /**
         * Da qui in poi decide un agente, non un `mapPool`.
         *
         * Il setup sopra resta com'era — grounding, casting, cover, riferimenti condivisi: si fa
         * una volta e non è una decisione. Quello che era una decisione mancante è cosa rendere,
         * in che ordine, e cosa correggere prima di ripagare una resa: vedi `ugc-agent.ts`.
         *
         * Se l'orchestratore non parte (modello giù, chiave mancante) il batch NON resta a terra:
         * si torna al comportamento di prima, che è renderle tutte in parallelo. Un agente in più
         * non deve poter togliere una funzione che prima funzionava.
         */
        const clipCtx = {
          writer,
          textId,
          brand,
          opts,
          aspect,
          materials,
          announceClip,
          videoCount,
          remakeMode,
          refVideoUrls,
          clipSeconds,
          platform,
          ai,
          finished,
          failed,
          baseSharedRefUrls,
          sharedParts,
          tally
        };
        const renderOne = (plan: ClipPlan) => runOneUgcClip(clipCtx, plan);

        let orchestrated = false;
        try {
          const outcome = await runUgcOrchestrator({
            supabase: opts.supabase,
            brandId: opts.brandId,
            userId: opts.userId,
            threadId: opts.threadId ?? undefined,
            brandName: brand.name || 'Brand',
            plans,
            renderClip: renderOne,
            finished,
            failed,
            concurrency: UGC_BATCH_CONCURRENCY,
            remainingMs: opts.deadline ? () => opts.deadline!.remainingMs() : undefined,
            abortSignal: opts.abortSignal,
            locale: opts.locale
          });
          orchestrated = outcome.steps > 0;
          if (outcome.summary) {
            writer.write({ type: 'text-delta', id: textId, delta: `${outcome.summary}\n` });
          }
        } catch (e) {
          console.error('[ugc-batch] orchestrator failed, falling back to plain render', e);
        }

        // Il fallback, e la ragione per cui è scritto così: `finished` e `failed` sono le stesse
        // strutture che l'orchestratore riempiva, quindi qui resta solo ciò che davvero non è mai
        // stato tentato — non si ri-rende niente di già reso, e non si ri-tenta alla cieca ciò che
        // è già fallito (il retry ragionato è dell'orchestratore, che legge il perché).
        const stillPending = plans.filter((p) => !finished.has(p.index) && !failed.has(p.index));
        if (stillPending.length && (!orchestrated || !opts.abortSignal?.aborted)) {
          if (!orchestrated) {
            console.warn(`[ugc-batch] plain render for ${stillPending.length} clip(s)`);
          }
          await mapPool(stillPending, UGC_BATCH_CONCURRENCY, renderOne, opts.abortSignal);
        }

        // I falliti NON sono "remaining": la continuazione riprende ciò che non è stato tentato,
        // non ciò che ha già fallito — o una clip impossibile andrebbe in loop fra le slice.
        const remaining = plans.filter((p) => !finished.has(p.index) && !failed.has(p.index));
        const timedOut = opts.deadline
          ? (opts.deadline.reached(), opts.deadline.expired)
          : false;
        const aborted = !!opts.abortSignal?.aborted;
        const needsContinue =
          remaining.length > 0 ||
          // Falliti = chiusi anche qui: una slice che finisce con 3 rese e 1 fallita non deve
          // accodare una continuazione che riprenderebbe zero clip.
          ((timedOut || aborted) && finished.size + failed.size < videoCount);
        if (needsContinue) {
          const locale = bilingualNoticeLocale(opts.locale);
          writer.write({
            type: 'text-delta',
            id: textId,
            delta: truncatedDesignerNotice(locale, true)
          });
          await opts.onTruncated?.(remaining);
        }
        }

        logAiCall({
          label: 'ugc-batch',
          provider: 'gemini',
          model: 'ugc-batch',
          ms: Date.now() - t0,
          ok: tally.done > 0,
          brandId: opts.brandId,
          userId: opts.userId,
          context: `ugc-batch:n${videoCount}:ok${tally.done}:fail${tally.failed}:products${products.length}:models${models.length}`
        });

        const finishId = `ugc-finish-${Date.now()}`;
        writer.write({ type: 'tool-input-start', toolCallId: finishId, toolName: 'finish' });
        writer.write({
          type: 'tool-output-available',
          toolCallId: finishId,
          output: {
            ok: true,
            summary: `Produced ${tally.done} of ${videoCount} UGC video${videoCount === 1 ? '' : 's'}${
              tally.failed ? ` (${tally.failed} failed)` : ''
            }.`
          }
        });
        writer.write({ type: 'text-end', id: textId });
        writer.write({ type: 'finish', finishReason: tally.done > 0 ? 'stop' : 'error' });
      });
    },
    onError: () => CHAT_USER_ERROR
  });

  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: opts.consumeSseStream,
    headers: opts.promptId
      ? { 'X-Media-Generator-Prompt-Id': opts.promptId }
      : undefined
  });
}
