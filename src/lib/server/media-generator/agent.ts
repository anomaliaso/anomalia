/**
 * Streaming agentic loop for the Designer › Media generator page.
 * Produces images (and optionally videos) while streaming text / reasoning / tool chips
 * the same way brand chat does — so the client can overlay a ChatLiveStatus on the grid.
 */
import { swallow } from '$lib/server/swallow';
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { tool, stepCountIs, hasToolCall } from 'ai';
import { harnessStreamText } from '$lib/server/harness';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { llmLanguageModel } from '$lib/server/llm';
import { resolveUserTurnMediaParts, type MediaPart } from '$lib/media-parts';
import { fetchImagePart } from '$lib/server/brand-context';
import { extractSdkUsage, logAiCall, withBrandContext } from '$lib/server/ai-log';
import {
  aspectRatioFor,
  brandVisualDirective,
  extractVisualPlaybook,
  loadBrandLogoImagePart,
  loadBrandMoodImageUrls,
  renderPostImage,
  uploadPostImage,
  type AspectRatio
} from '$lib/server/content-preview';
import { IMAGE_AGENT_MODEL } from '$lib/server/image-agent';
import { createAgentBase } from '$lib/server/agent-base';
import { geminiFast } from '$lib/server/chat/model';
import {
  brandContextPromptSection,
  createBrandContextTools
} from '$lib/server/chat/brand-context-tools';
import { disruptiveBriefSection } from '$lib/disruptive';
import { createDisruptiveIdeaTools } from '$lib/server/disruptive-ideas';

export type MediaKindPreference = 'auto' | 'image' | 'video';

export type MediaGeneratorOpts = {
  supabase: SupabaseClient;
  userId: string;
  brandId: string;
  /** Thread di questo giro: obiettivo e artefatti appartengono a una conversazione. */
  threadId?: string;
  /** Quanto resta al turno — i sotto-agenti devono saperlo prima di partire. */
  remainingMs?: () => number;
  prompt: string;
  aspectRatio?: AspectRatio;
  /** Prefer image, video, or let the agent decide. */
  kind?: MediaKindPreference;
  /** How many distinct variants to produce per target (1–4). With multi-ref edits this multiplies by targeted refs. */
  variants?: number;
  /** Library media ids pinned by the user (from brand library picks). */
  mediaIds?: string[];
  /** Public / data URLs selected from the page grid or uploads. */
  referenceUrls?: string[];
  /**
   * When false, skip brand visual_style / look / playbook / mood refs so the model
   * is free to invent a look from the prompt alone (user references still apply).
   */
  useBrandStyle?: boolean;
  /**
   * UGC Creator mode: lock to talking UGC videos (ugc:true, ≤15s PAS scripts)
   * and persist every produced item with ugc=true.
   */
  forceUgc?: boolean;
  /** Prompt history row — each successful render is persisted against this id. */
  promptId?: string | null;
  abortSignal?: AbortSignal;
  /** kie video model override from the media-generator UI (kind=video). */
  videoModel?: string | null;
  /** Seedance 2.5 first-frame still (public or data URL). */
  firstFrameUrl?: string | null;
  /** Seedance 2.5 last-frame still. */
  lastFrameUrl?: string | null;
  /** Seedance 2.5 reference video URLs. */
  referenceVideoUrls?: string[];
  /** Seedance 2.5 reference audio URLs. */
  referenceAudioUrls?: string[];
};

const MAX_STEPS = 28;
/** Hard cap: 4 attached refs × 4 variants. */
const MAX_IMAGES = 16;
const MAX_VIDEOS = 16;
const MOOD_REF_CAP = 4;
const MAX_USER_REFS = 4;

function clampVariants(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(4, Math.max(1, Math.round(v)));
}

/**
 * Image/video budget for one run. When refs are attached we allow
 * `variants × refCount` so "edit all of these" can emit one (or N) take(s)
 * per photo. The agent still finishes after `variants` total when refs are
 * only inspiration — budget is a ceiling, not a quota.
 */
export function mediaGeneratorBudget(opts: {
  kind: MediaKindPreference;
  variants: number;
  refCount: number;
}): { images: number; videos: number } {
  const variants = clampVariants(opts.variants);
  const refs = Math.max(0, Math.min(MAX_USER_REFS, Math.floor(opts.refCount)));
  const ceiling = Math.min(MAX_IMAGES, variants * Math.max(refs, 1));
  if (opts.kind === 'image') {
    return { images: ceiling, videos: 0 };
  }
  if (opts.kind === 'video') {
    // Covers + clips: allow a still per output and a video per output.
    return { images: ceiling, videos: Math.min(MAX_VIDEOS, ceiling) };
  }
  return { images: ceiling, videos: Math.min(MAX_VIDEOS, ceiling) };
}

export function buildSystem(opts: {
  aspect: AspectRatio;
  kind: MediaKindPreference;
  variants: number;
  useBrandStyle: boolean;
  forceUgc?: boolean;
  visualStyle?: string;
  brandLook?: string;
  visualPlaybook?: string;
  /** What the brand is / sells — always on for spoken content, independent of visual style. */
  brandIdentity?: string;
  refCount: number;
  imageBudget: number;
  videoBudget: number;
  videoModel?: string | null;
  hasSeedanceMaterials?: boolean;
}): string {
  const kindLine = opts.forceUgc
    ? 'Produce UGC talking VIDEO(s) only. Always call generate_video with ugc:true and durationSeconds≤15. Prefer a still cover via generate_image first when useful, then animate it. Use subject/camera/audio/timeline shot briefs (never a vibe paragraph), and a CONCISE spoken PAS script (~40–48 words total — brand-relevant problem → agitate → brand/feature solution → soft CTA; personal and emotional, not a rant). Pain must be THIS brand\'s category problem — never medical/family/unrelated life drama. Never burn captions/subtitles on the clip. After every generate_video the system auto-reviews the clip (calendar-style score). If the verdict is fix/kill or the score is below 7, remake from the QC notes — do not ship the first take. You may still call review_video to re-score a reference/competitor clip.'
    : opts.kind === 'image'
      ? 'Produce IMAGE(s) only — do not call generate_video.'
      : opts.kind === 'video'
        ? opts.hasSeedanceMaterials
          ? 'Produce VIDEO(s). The user already supplied Seedance materials (first/last frame and/or reference audio/video). When a reference VIDEO is present, call breakdown_reference_video FIRST to reverse-engineer a second-by-second shot brief, then pass that brief as the generate_video prompt (and keep the reference video URL). Remake intent ("rifallo", "redo", "change the script") → keep the reference video URL and apply the brief changes. Do NOT invent a new cover with generate_image unless they left every frame/ref empty.'
          : 'Produce VIDEO(s). Prefer a UGC STORYBOARD first: generate_image for the HOOK cover (pain-moment face, product NOT visible yet), optionally a DEMO still, then generate_video. Organic UGC: ugc:true, durationSeconds≤15. Paid UGC ads: ugc:true + ugcAd:true → forces Seedance 2.5 at 22s. Use ALL-CAPS Seedance block prompts (REFERENCES/CAMERA/LOOK/STYLE/STAGES/CONSTRAINTS). Spoken script: Hook → Problem → Demo → Proof → CTA; pain must be brand-category relevant (never invent medical/family/unrelated life drama); name the brand/feature in the solution beat. If the user selected an existing grid VIDEO to remake, that URL is in the run as a Seedance reference video — keep it and revise from the brief (Seedance only; Grok cannot take video refs).'
        : 'Decide whether the brief needs an image, a video, or both. Prefer images unless motion is clearly requested.';

  const modelLine = opts.videoModel
    ? `Video model is LOCKED to "${opts.videoModel}" for this run — generate_video must not pick another.`
    : '';

  const variantsLine =
    opts.refCount > 0
      ? `Variants setting = ${opts.variants}. This is the number of DISTINCT takes PER TARGET — not always a global total.

How to read the brief when ${opts.refCount} reference image(s) are attached (Ref 0…Ref ${opts.refCount - 1}):

Case A — EDIT the attached photo(s)
  User asks to change / remove / add something ON the attached image(s), or says "all of them", "each", "these", "tutte", "ognuna", etc.
  → For EACH targeted ref, call generate_image ${opts.variants} time(s) with that photo as baseRefIndex.
  → Expected total ≈ (# targeted refs) × ${opts.variants}.
  → Examples:
     • 4 refs, "remove the watermark from all", variants=1 → 4 calls (baseRefIndex 0,1,2,3).
     • 4 refs, same brief, variants=4 → 16 calls (4 distinct takes per ref).
     • 4 refs, "edit only the first two", variants=1 → 2 calls (baseRefIndex 0 and 1).
  → Do NOT stop after 1 image when multiple attached photos were clearly targeted.

Case B — NEW image, refs as inspiration only
  User wants something new and the attachments are style / subject / mood references — they did NOT ask to modify those files.
  → Produce exactly ${opts.variants} result(s) TOTAL. Attached count ≠ output count. Do not multiply by ref count.
  → Omit baseRefIndex (or only pass refs as style). Invent a new frame.

Case C — Ambiguous
  If unclear, prefer Case A when the verb is edit/remove/add-on/change applied to "these images"; prefer Case B when the brief describes a new scene and refs are just examples.

Never treat "N refs attached" alone as "make N images" — only when the brief targets those photos for editing.`
      : opts.variants <= 1
        ? 'Produce exactly 1 result (no extra variations unless the brief clearly asks).'
        : `Produce exactly ${opts.variants} DISTINCT variants. Call the generate tool ${opts.variants} times with meaningfully different compositions / angles / lighting — do not finish early with fewer.`;

  const styleBits = opts.useBrandStyle
    ? [
        opts.visualStyle?.trim() ? `Brand visual brief:\n${opts.visualStyle.trim()}` : '',
        opts.brandLook?.trim() ? `Brand look:\n${opts.brandLook.trim()}` : '',
        opts.visualPlaybook?.trim() ? `Visual playbook:\n${opts.visualPlaybook.trim()}` : ''
      ]
        .filter(Boolean)
        .join('\n\n')
    : `Brand visual style is OFF for this run. Do NOT follow the brand kit look, palette, fonts, mood boards, or visual playbook. Invent freely from the user's prompt (and any attached reference images only).`;

  const identityBits = opts.brandIdentity?.trim()
    ? `\n${opts.brandIdentity.trim()}\n`
    : '';

  const roleLine = opts.useBrandStyle
    ? `You are Anomalia's media generator agent. You create on-brand images and short videos for a design studio grid (not social posts — no captions).`
    : `You are Anomalia's media generator agent. You create images and short videos for a design studio grid (not social posts — no captions). Visual style is free — ignore brand identity look unless the user pasted references. Spoken scripts and product claims still follow BRAND IDENTITY below.`;

  const refLine = opts.refCount
    ? `The user attached ${opts.refCount} reference image(s) — you can SEE them in this message, labeled Ref 0…Ref ${opts.refCount - 1}.
- When EDITING a specific attached photo, pass baseRefIndex for that Ref. The photo is the REAL base frame; keep scene/subject/composition and apply only the asked change.
- To ADD a logo, watermark, brand mark, or light edit on a photo → generate_image with the right baseRefIndex. Do NOT call design_graphic — that builds a fresh typographic canvas and will DROP the photo.
- design_graphic only when the brief is WORDS-led (quote, stat, list, price) AND you intentionally want type on a canvas. If you still use design_graphic with a selected photo, the photo MUST become the full-bleed background and the logo an image block — never a blank white canvas with only the logo.
- Budget this run: ≤${opts.imageBudget} images, ≤${opts.videoBudget} videos (enough for variants×refs when editing all; use less when Case B).`
    : '';

  return `${roleLine}

Workflow:
1. Briefly plan what you will make (1–3 short sentences the user can read live). State Case A vs B when refs are attached, and the expected output count.
2. For spoken UGC / product claims: call read_brand_studio first (and read_media when the brief mentions screenshots/library assets). These are free.
3. Call generate_image and/or generate_video as needed (budget: ≤${opts.imageBudget} images, ≤${opts.videoBudget} videos).
4. After each successful render, briefly note what you got (include which Ref when editing).
5. Call finish when the required count for the case is met (or when budget is exhausted).

${kindLine}
${modelLine}
${variantsLine}
Default aspect ratio: ${opts.aspect}.
${refLine}
${identityBits}
${brandContextPromptSection()}

${disruptiveBriefSection()}
Quando l'idea passa i tre test, salvala con save_disruptive_idea prima di renderla: il banco è del brand, non di questa esecuzione. Nessun minimo da raggiungere — si salva quello che nasce, non si inventa per riempire. read_disruptive_ideas per sapere cosa c'è già; se giri una di quelle, mark_idea_used subito dopo.

Rules:
- Think out loud briefly before each tool call so the UI can show your reasoning.
- Pick the right maker for the brief: design_graphic when the piece is WORDS (quote card, statistic, list, price, title slide) — real type, always sharp and correctly spelled; generate_image when it needs a scene, a person, a product, a place, OR when editing / branding an attached photo. A brief that is mostly a sentence to be read is a graphic, not a photo of text — unless a reference photo is attached and the user asked to put type/logo ON that photo (then generate_image).
- To CHANGE a graphic from this run, call design_graphic again with its editItemId — the design is stored, so the edit keeps everything the user did not ask to change, and each version is saved.
- Variants of the SAME target must differ in composition / treatment — not tiny crops of the same frame.
- For video: ${opts.hasSeedanceMaterials ? 'use the user-supplied Seedance frames/refs on generate_video; skip inventing a cover unless every material field is empty.' : 'always generate (or reuse) a cover still first when possible, then animate it.'}
- For spoken UGC scripts: call read_brand_studio (and read_media if needed) before scripting. Follow BRAND IDENTITY + Studio data + the user brief. Never invent medical/family/relationship/unrelated money-stress stories. Name the brand or a real feature in the solution beat.
- finish must summarize what was produced and which refs were targeted (if any).

${styleBits}`.trim();
}

export async function streamMediaGenerator(opts: MediaGeneratorOpts) {
  return withBrandContext(opts.brandId, () => streamMediaGeneratorInner(opts));
}

async function streamMediaGeneratorInner(opts: MediaGeneratorOpts) {
  const forceUgc = opts.forceUgc === true;
  const aspect = opts.aspectRatio ?? (forceUgc ? ('9:16' as AspectRatio) : aspectRatioFor('instagram'));
  const kind: MediaKindPreference = forceUgc ? 'video' : (opts.kind ?? 'auto');
  const variants = clampVariants(opts.variants);
  const useBrandStyle = opts.useBrandStyle !== false;
  const ai = null as never;

  const [{ data: kit }, { data: brandRow }] = await Promise.all([
    opts.supabase
      .from('brand_kit')
      .select('visual_style, ai_context, brand_colors, fonts, graphic_style, logos, favicon_url, about, category, target_audience, brand_style')
      .eq('brand_id', opts.brandId)
      .maybeSingle(),
    opts.supabase.from('brands').select('name, content_prefs').eq('id', opts.brandId).maybeSingle()
  ]);

  const brandLook = useBrandStyle
    ? brandVisualDirective(
        kit?.brand_colors as string[] | null,
        (Array.isArray(kit?.fonts) ? (kit!.fonts as { name?: string }[]) : [])
          .map((f) => f?.name)
          .filter(Boolean) as string[]
      )
    : '';
  const visualStyle = useBrandStyle
    ? (kit?.visual_style as string | undefined) || undefined
    : undefined;
  const visualPlaybook = useBrandStyle
    ? extractVisualPlaybook(kit?.ai_context) || undefined
    : undefined;

  // Brand IDENTITY for spoken scripts / product claims. The whole Studio document now, not five
  // fields and a products query of its own — the generator invents the scene, the wardrobe and the
  // props, so it needs the faces and the art direction as much as the catalogue.
  //
  // `useBrandStyle` is a user-facing toggle: when they turn the brand look off, the look sections go
  // with it. That is what the per-section switches are for — the identity and the offerings stay,
  // because a script must still be ABOUT this brand whatever palette it is shot in.
  let brandIdentity = '';
  try {
    const { formatUgcBrandGrounding, identityFromAiContext } = await import(
      '$lib/server/media-generator/brand-grounding'
    );
    const { loadDesignDoc } = await import('$lib/server/brand-design-doc');
    const prefs =
      brandRow?.content_prefs && typeof brandRow.content_prefs === 'object'
        ? (brandRow.content_prefs as Record<string, unknown>)
        : {};
    const designDoc = await loadDesignDoc(opts.supabase, opts.brandId, {
      brandName: String(brandRow?.name ?? '').trim() || 'Brand',
      toolHints: false,
      include: {
        documents: false,
        look: useBrandStyle,
        visualStyle: useBrandStyle,
        graphic: useBrandStyle
      }
    });
    brandIdentity = formatUgcBrandGrounding({
      designDoc,
      name: String(brandRow?.name ?? '').trim() || 'Brand',
      about: String(kit?.about ?? '').trim(),
      category: String(kit?.category ?? '').trim(),
      audience: String(kit?.target_audience ?? '').trim(),
      brandStyle: String(kit?.brand_style ?? '').trim(),
      // Only read if the document came back empty (a Studio with nothing in it) — the fallback
      // block must not be poorer than what it replaced.
      aiContext: designDoc ? '' : identityFromAiContext(kit?.ai_context),
      offerings: [],
      language: typeof prefs.language === 'string' ? prefs.language.trim() : ''
    });
  } catch (e) {
    console.error('[media-generator] brand identity load failed', e);
  }

  const moodUrls = useBrandStyle
    ? await loadBrandMoodImageUrls(opts.supabase, opts.brandId).catch((error) => { swallow('load mood image urls', error); return []; })
    : [];
  const moodParts = (
    await Promise.all(moodUrls.slice(0, MOOD_REF_CAP).map((u) => fetchImagePart(u)))
  ).filter(Boolean) as Array<{ inlineData: { mimeType: string; data: string } }>;

  const libraryRefs = opts.mediaIds?.length
    ? await (
        await import('$lib/server/brand-media')
      ).loadLibraryMediaParts(opts.supabase, opts.brandId, opts.mediaIds)
    : [];
  const userRefParts = (
    await Promise.all((opts.referenceUrls ?? []).slice(0, MAX_USER_REFS).map((u) => fetchImagePart(u)))
  ).filter(Boolean) as Array<{ inlineData: { mimeType: string; data: string } }>;
  const referenceParts = [...libraryRefs, ...userRefParts].slice(0, MAX_USER_REFS);
  if ((opts.referenceUrls?.length || opts.mediaIds?.length) && !referenceParts.length) {
    console.warn(
      '[media-generator] user attached reference URL(s)/mediaIds but fetchImagePart returned nothing — renderer will not see them'
    );
  }

  const logoImage = (await loadBrandLogoImagePart(kit?.logos)) ?? undefined;

  const refCount = referenceParts.length;
  const budget = mediaGeneratorBudget({ kind, variants, refCount });
  let imagesLeft = budget.images;
  let videosLeft = budget.videos;
  const produced: Array<{ type: 'image' | 'video'; url: string; prompt: string; id?: string }> = [];

  async function persistItem(
    kindOut: 'image' | 'video',
    url: string,
    promptText: string,
    aspectOut: string,
    ugc = false
  ) {
    try {
      const { insertMediaGeneratorItem } = await import('$lib/server/media-generator/persist');
      const saved = await insertMediaGeneratorItem(opts.supabase, {
        brandId: opts.brandId,
        userId: opts.userId,
        promptId: opts.promptId,
        kind: kindOut,
        url,
        prompt: promptText,
        aspect: aspectOut,
        ugc: forceUgc || ugc
      });
      if ('row' in saved) return saved.row.id;
    } catch (e) {
      console.error('[media-generator] persist failed', e);
    }
    return undefined;
  }

  const system = buildSystem({
    aspect,
    kind,
    variants,
    useBrandStyle,
    forceUgc,
    visualStyle,
    brandLook: brandLook || undefined,
    visualPlaybook,
    brandIdentity: brandIdentity || undefined,
    refCount,
    imageBudget: budget.images,
    videoBudget: budget.videos,
    videoModel: opts.videoModel,
    hasSeedanceMaterials: !!(
      opts.firstFrameUrl ||
      opts.lastFrameUrl ||
      opts.referenceVideoUrls?.length ||
      opts.referenceAudioUrls?.length
    )
  });

  /**
   * LA BASE COMUNE. Questa pagina era l'unica delle quattro senza niente: nessuna delega, nessuna
   * macchina, nessun obiettivo, nessun artefatto — un loop che conia immagini e si dichiara finito
   * da solo. Ora monta la stessa base di chat, Motion e UGC.
   */
  const base = await createAgentBase({
    supabase: opts.supabase,
    brandId: opts.brandId,
    userId: opts.userId,
    threadId: opts.threadId,
    model: (() => {
      const b = geminiFast();
      const id = IMAGE_AGENT_MODEL();
      return id === b.modelId ? b : { ...b, model: llmLanguageModel(id), modelId: id };
    })(),
    defaultAgent: 'media',
    surfaceWriteKeys: ['generate_image', 'generate_video', 'design_graphic'],
    remainingMs: opts.remainingMs,
    // Un'immagine consegnata è un artefatto che qualcuno guarderà: la review non è facoltativa.
    requireReview: true,
    label: 'MediaGen'
  });

  const tools = base.attach({
    // read_brand_studio / read_knowledge used to be declared here, verbatim again in the UGC
    // planner, and nowhere in Motion Video. One definition now, plus the market catalog and the
    // web search this agent never had.
    ...createBrandContextTools({ supabase: opts.supabase, brandId: opts.brandId }),
    // Stesso banco idee della chat e del planner UGC: qui nascono angoli visivi che altrimenti
    // vivono solo dentro il prompt di una singola resa.
    ...createDisruptiveIdeaTools({
      supabase: opts.supabase,
      brandId: opts.brandId,
      userId: opts.userId,
      surface: 'media',
      agent: 'media'
    }),
    read_media: tool({
      description:
        'Search the brand Media library (screenshots, UI, product photos). Use when the brief mentions screenshots/media to reuse.',
      inputSchema: z.object({
        query: z.string().optional(),
        kind: z.enum(['image', 'video']).optional(),
        limit: z.number().int().min(1).max(40).optional()
      }),
      execute: async (input) => {
        const { readMediaForAgent } = await import('$lib/server/strategy-agent-reads');
        return readMediaForAgent(opts.supabase, opts.brandId, input);
      }
    }),

    generate_image: tool({
      description: `Render or EDIT a still with Nano Banana Pro. When editing an attached photo, pass baseRefIndex (Ref 0…${Math.max(0, refCount - 1)}) so that photo is the BASE frame. Brand-kit logo is auto-attached. Budget: ${budget.images} images this run.`,
      inputSchema: z.object({
        prompt: z.string().describe('Detailed image generation / edit prompt'),
        aspect: z.enum(['1:1', '4:5', '9:16', '16:9']).optional(),
        baseRefIndex: z
          .number()
          .int()
          .min(0)
          .max(Math.max(0, MAX_USER_REFS - 1))
          .optional()
          .describe(
            'Which attached reference (0-based Ref N) is the BASE photo to edit in place. Required for Case A (edit attached photos). Omit for Case B (new image; refs are inspiration only). With a single attached ref and an edit brief, pass 0.'
          )
      }),
      execute: async ({ prompt, aspect: aspectIn, baseRefIndex }) => {
        return withBrandContext(opts.brandId, async () => {
          if (imagesLeft <= 0) return { error: `image budget exhausted (max ${budget.images})` };
          imagesLeft -= 1;
          try {
            const ratio = (aspectIn ?? aspect) as AspectRatio;
            const hasExplicitBase =
              typeof baseRefIndex === 'number' &&
              Number.isInteger(baseRefIndex) &&
              baseRefIndex >= 0 &&
              baseRefIndex < referenceParts.length;

            let baseImage: (typeof referenceParts)[number] | undefined;
            let extraRefs: typeof referenceParts = [];

            if (hasExplicitBase) {
              // Case A: edit one specific attached photo — do not mix other refs into the base.
              baseImage = referenceParts[baseRefIndex!];
              extraRefs = [];
            } else if (referenceParts.length === 1) {
              // Single attachment defaults to edit-base (common "add logo to this" path).
              baseImage = referenceParts[0];
              extraRefs = [];
            } else if (referenceParts.length > 1) {
              // Case B: multi-ref inspiration for a NEW frame — no single base.
              baseImage = undefined;
              extraRefs = referenceParts;
            }

            const promptText = baseImage
              ? `${prompt}\n\nEdit the attached BASE photo (Ref ${hasExplicitBase ? baseRefIndex : 0}) in place — keep the scene, subject and composition; apply only what this prompt asks. Do not replace the photo with a blank canvas.`
              : prompt;
            const dataUrl = await renderPostImage(ai, promptText, {
              baseImage,
              referenceImages: extraRefs.length ? extraRefs : undefined,
              referenceMode: extraRefs.length ? 'product' : undefined,
              logoImage,
              moodImages: useBrandStyle && moodParts.length ? moodParts : undefined,
              visualStyle: useBrandStyle ? visualStyle : undefined,
              visualPlaybook: useBrandStyle ? visualPlaybook : undefined,
              brandLook: useBrandStyle ? brandLook || undefined : undefined,
              aspectRatio: ratio
            });
            if (!dataUrl) return { error: 'No image returned' };
            const imageUrl = await uploadPostImage(opts.supabase, opts.userId, dataUrl, ratio);
            if (!imageUrl) return { error: 'Upload failed' };
            const id = await persistItem('image', imageUrl, prompt, ratio);
            produced.push({ type: 'image', url: imageUrl, prompt, id });
            return {
              ok: true,
              type: 'image' as const,
              url: imageUrl,
              prompt,
              id,
              base_ref_index: hasExplicitBase ? baseRefIndex : baseImage ? 0 : null,
              used_base_photo: !!baseImage,
              used_logo_ref: !!logoImage
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        });
      }
    }),

    breakdown_reference_video: tool({
      description:
        'Reverse-engineer a winning UGC reference video into a Seedance shot brief (subject/camera/audio/second-by-second timeline). Call this BEFORE generate_video when the user supplied a reference video — the returned prompt becomes the generate_video brief. Free — does not spend the video budget.',
      inputSchema: z.object({
        url: z
          .string()
          .optional()
          .describe('Public URL of the reference video. Defaults to the first user-supplied reference video.'),
        script: z
          .string()
          .optional()
          .describe('Optional spoken line to lock in (replaces the reference dialogue).')
      }),
      execute: async ({ url, script }) => {
        try {
          const { breakdownReferenceVideo, shotBriefPromptFromBreakdown } = await import(
            '$lib/server/video-breakdown'
          );
          const target = url?.trim() || opts.referenceVideoUrls?.[0]?.trim();
          if (!target) return { error: 'No reference video URL — attach one or pass url.' };
          const breakdown = await breakdownReferenceVideo(target);
          if (!breakdown) return { error: 'Breakdown failed (fetch/ffmpeg/model). Write a shot brief manually.' };
          const prompt = shotBriefPromptFromBreakdown(breakdown, { script });
          return {
            ok: true,
            prompt,
            dialogueSummary: breakdown.dialogueSummary,
            durationSeconds: breakdown.durationSeconds,
            subject: breakdown.brief.subject,
            camera: breakdown.brief.camera,
            audio: breakdown.brief.audio,
            beats: breakdown.brief.timeline.length
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
    }),

    review_video: tool({
      description:
        'Review a FINISHED clip against organic UGC or paid-ads standards (hook, doomscroll stop, sound-off, hold, CTA/offer). Call when the user asks if a generated video works, or to QC a reference/competitor clip. Credits only — does not spend the video budget.',
      inputSchema: z.object({
        url: z
          .string()
          .optional()
          .describe('Public URL of the video. Defaults to the last generated clip or the first reference video.'),
        standard: z
          .enum(['organic', 'ads'])
          .optional()
          .describe('organic = Reels/TikTok UGC (default in UGC Creator). ads = paid UGC ad.'),
        script: z.string().optional()
      }),
      execute: async ({ url, standard, script }) => {
        try {
          const { parseVideoStandard, reviewVideo } = await import('$lib/server/video-review');
          const target =
            url?.trim() ||
            produced.filter((p) => p.type === 'video').at(-1)?.url ||
            opts.referenceVideoUrls?.[0]?.trim() ||
            '';
          if (!target) return { error: 'No video URL — pass url or generate a clip first.' };
          const std = parseVideoStandard(standard) ?? 'organic';
          const result = await reviewVideo(target, {
            standard: std,
            brandName: String(brandRow?.name ?? '').trim() || null,
            script: script?.trim() || null,
            language:
              brandRow?.content_prefs && typeof brandRow.content_prefs === 'object'
                ? String((brandRow.content_prefs as { language?: string }).language ?? '').trim() ||
                  null
                : null
          });
          if (!result.ok) return { error: result.error };
          const { persistReadyReview } = await import('$lib/server/video-review-store');
          await persistReadyReview(opts.supabase, {
            brandId: opts.brandId,
            url: target,
            standard: std,
            review: result.review
          });
          return { ok: true, ...result.review };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
    }),

    generate_video: tool({
      description: `Animate a cover (or Seedance multimodal refs) into a short clip via kie. Prefer passing coverImageUrl from a prior generate_image unless the user already supplied a first frame / refs. When a reference video exists, prefer a shot brief from breakdown_reference_video as the prompt. Budget: ${budget.videos} videos this run.`,
      inputSchema: z.object({
        prompt: z.string().describe('Motion / scene direction — prefer a subject/camera/audio/timeline shot brief for UGC'),
        coverImageUrl: z
          .string()
          .optional()
          .describe('Public URL of a still to animate (image-to-video). Ignored when the user already set a first frame.'),
        aspect: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', 'adaptive']).optional(),
        durationSeconds: z
          .number()
          .int()
          .min(4)
          .max(30)
          .optional()
          .describe(
            'Clip length in seconds. Organic UGC ≤15; ugcAd:true locks 22s on Seedance 2.5. Prefer a shorter script over a longer clip.'
          ),
        ugc: z.boolean().optional().describe('Opt into handheld UGC genre + dead-space tighten. Spoken audio only when script is set — never burn captions/subtitles on UGC.'),
        ugcAd: z
          .boolean()
          .optional()
          .describe(
            'Paid UGC ad. Requires ugc:true. Forces Seedance 2.5 and locks duration to 22s (fuller Demo+Proof). Omit/false = organic ≤15s.'
          ),
        script: z
          .string()
          .optional()
          .describe(
            'Spoken line for talking UGC (lip-sync). Organic ≤~48 words (15s); ugcAd ≤~66 words (22s). Hook → Problem → Demo → Proof → CTA. Lead with a BRAND-RELEVANT pain moment (this category\'s job-to-be-done) — never medical/family/unrelated life drama — then name the brand/feature in the solution.'
          )
      }),
      execute: async ({ prompt, coverImageUrl, aspect: aspectIn, durationSeconds, ugc, ugcAd, script }) => {
        return withBrandContext(opts.brandId, async () => {
          if (videosLeft <= 0) return { error: `video budget exhausted (max ${budget.videos})` };
          if (kind === 'image') return { error: 'Video disabled for this run' };
          videosLeft -= 1;
          try {
            const { renderVideo, videoModelCaps, isKnownVideoModel, UGC_AD_DURATION, UGC_ORGANIC_MAX_DURATION } =
              await import('$lib/server/video');
            const { SEEDANCE_25_MODEL } = await import('$lib/video-models');
            const isUgc = forceUgc || ugc === true;
            const isAd = isUgc && ugcAd === true;
            const lockedModel = isAd
              ? SEEDANCE_25_MODEL
              : opts.videoModel && isKnownVideoModel(opts.videoModel)
                ? opts.videoModel
                : null;
            const caps = videoModelCaps(lockedModel ?? 'grok-imagine-video-1-5-preview');
            const firstFrame =
              opts.firstFrameUrl?.trim() ||
              coverImageUrl ||
              produced.filter((p) => p.type === 'image').at(-1)?.url ||
              opts.referenceUrls?.[0];

            // Auto reverse-engineer when a ref video is present and the prompt is not already a shot brief.
            let freeform: string | undefined = /\bsubject\s*:/i.test(prompt) ? prompt : undefined;
            let duration = durationSeconds;
            const spoken = script?.trim() || undefined;
            // UGC organic ≤15s; UGC ads = 22s on Seedance 2.5 — never grow past the cap for a long line.
            if (isUgc) {
              const cap = isAd ? UGC_AD_DURATION : UGC_ORGANIC_MAX_DURATION;
              duration = Math.min(duration ?? cap, cap);
            }
            const refVid = opts.referenceVideoUrls?.[0]?.trim();
            if (refVid && !freeform) {
              try {
                const { breakdownReferenceVideo, shotBriefPromptFromBreakdown } = await import(
                  '$lib/server/video-breakdown'
                );
                const breakdown = await breakdownReferenceVideo(refVid);
                if (breakdown) {
                  freeform = shotBriefPromptFromBreakdown(breakdown, { script: spoken });
                  if (duration == null && breakdown.durationSeconds) {
                    duration = Math.round(breakdown.durationSeconds);
                  }
                }
              } catch (error) { swallow('derive shot brief from breakdown', error); }
            }
            if (isUgc) {
              const cap = isAd ? UGC_AD_DURATION : UGC_ORGANIC_MAX_DURATION;
              duration = Math.min(duration ?? cap, cap);
            }
            const motionPrompt = freeform || prompt;
            // UGC + a subject/camera/timeline brief must stay on the UGC template (SPEECH COMPLETE,
            // finish-every-word). Passing that brief as `prompt` flips freeform mode and drops the
            // rails — which is how talking clips got cut mid-line.
            const shotBrief = isUgc && freeform ? freeform : undefined;
            const creativePrompt = !isUgc && freeform ? freeform : undefined;

            const rendered = await renderVideo(opts.supabase, opts.userId, motionPrompt, {
              imageUrl: firstFrame,
              firstFrameUrl: opts.firstFrameUrl,
              lastFrameUrl: opts.lastFrameUrl,
              referenceVideoUrls: opts.referenceVideoUrls,
              referenceAudioUrls: opts.referenceAudioUrls,
              aspectRatio: aspectIn ?? (aspect === '16:9' ? '16:9' : '9:16'),
              visualStyle: useBrandStyle ? visualStyle : undefined,
              duration: duration != null
                ? Math.min(caps.maxDuration, Math.max(caps.minDuration, duration))
                : undefined,
              model: lockedModel,
              prompt: creativePrompt,
              shotBrief,
              ugc: isUgc,
              ugcAd: isAd,
              script: spoken
            });
            if (!rendered?.url) return { error: 'Video render returned nothing' };
            const videoAspect = aspectIn ?? (aspect === '16:9' ? '16:9' : '9:16');
            let final = rendered;
            let id = await persistItem('video', final.url, motionPrompt, videoAspect, isUgc);
            let review: ReturnType<
              typeof import('$lib/server/video-review-apply').compactReviewForTool
            > | undefined;

            if (isUgc) {
              const {
                compactReviewForTool,
                formatReviewApplyBrief,
                reviewNeedsRewrite,
                scoreFinishedClip,
                VIDEO_QC_REMAKE_MAX
              } = await import('$lib/server/video-review-apply');
              const { deleteMediaGeneratorItem } = await import('$lib/server/media-generator/persist');
              const language =
                brandRow?.content_prefs && typeof brandRow.content_prefs === 'object'
                  ? String((brandRow.content_prefs as { language?: string }).language ?? '').trim() ||
                    null
                  : null;
              const scoreClip = (url: string) =>
                scoreFinishedClip(opts.supabase, {
                  brandId: opts.brandId,
                  url,
                  // Automatico: giudizio in linea che pilota il rifacimento della clip.
                  auto: true,
                  standard: isAd ? 'ads' : 'organic',
                  opts: {
                    standard: isAd ? 'ads' : 'organic',
                    brandName: String(brandRow?.name ?? '').trim() || null,
                    script: spoken || null,
                    language,
                    kind: 'video',
                    abortSignal: opts.abortSignal
                  }
                });
              let qc = await scoreClip(final.url);
              if (qc.ok && reviewNeedsRewrite(qc.review)) {
                for (let attempt = 0; attempt < VIDEO_QC_REMAKE_MAX; attempt += 1) {
                  if (opts.abortSignal?.aborted) break;
                  try {
                    const applyBrief = `${motionPrompt}\n\n${formatReviewApplyBrief(qc.review, 'ugc')}`;
                    const remade = await renderVideo(opts.supabase, opts.userId, applyBrief, {
                      imageUrl: firstFrame,
                      firstFrameUrl: opts.firstFrameUrl,
                      lastFrameUrl: opts.lastFrameUrl,
                      referenceVideoUrls: [final.url, ...(opts.referenceVideoUrls ?? [])].slice(
                        0,
                        10
                      ),
                      referenceAudioUrls: opts.referenceAudioUrls,
                      aspectRatio: aspectIn ?? (aspect === '16:9' ? '16:9' : '9:16'),
                      visualStyle: useBrandStyle ? visualStyle : undefined,
                      duration: duration != null
                        ? Math.min(caps.maxDuration, Math.max(caps.minDuration, duration))
                        : undefined,
                      model: lockedModel,
                      prompt: creativePrompt ? applyBrief : undefined,
                      shotBrief: shotBrief ? applyBrief : undefined,
                      ugc: isUgc,
                      ugcAd: isAd,
                      script: spoken
                    });
                    if (!remade?.url) break;
                    const prevId = id;
                    const remadeQc = await scoreClip(remade.url);
                    const remadeId = await persistItem(
                      'video',
                      remade.url,
                      motionPrompt,
                      videoAspect,
                      isUgc
                    );
                    if (prevId) {
                      await deleteMediaGeneratorItem(opts.supabase, opts.brandId, prevId).catch(swallow('delete replaced item'));
                    }
                    final = remade;
                    id = remadeId;
                    qc = remadeQc;
                    if (!qc.ok || !reviewNeedsRewrite(qc.review)) break;
                  } catch (e) {
                    console.error('[media-generator] QC remake failed', e);
                    break;
                  }
                }
              }
              if (qc.ok) review = compactReviewForTool(qc.review);
            }

            produced.push({ type: 'video', url: final.url, prompt: motionPrompt, id });
            return {
              ok: true,
              type: 'video' as const,
              url: final.url,
              prompt: motionPrompt,
              id,
              coverImageUrl: firstFrame,
              duration: final.durationSeconds,
              taskId: final.taskId,
              model: lockedModel,
              review
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        });
      }
    }),

    design_graphic: tool({
      description:
        'Compose a typographic piece — words on a brand-coloured canvas, optionally with embedded photos. Prefer generate_image when the user selected a photo and asked to add a logo / edit that photo. Use design_graphic for WORDS-led briefs (quote, statistic, list, price). Brand kit logo is auto-included. Pass editItemId to revise a graphic from this run.',
      inputSchema: z.object({
        brief: z
          .string()
          .describe('What the piece should say — or, with editItemId, what to change about it. Include the exact number, quote or price if one matters.'),
        aspect: z.enum(['1:1', '4:5', '9:16', '16:9']).optional(),
        editItemId: z.string().optional().describe('Id of a graphic produced earlier in this run, to revise instead of composing a new one.')
      }),
      execute: async ({ brief, aspect: aspectIn, editItemId }) => {
        return withBrandContext(opts.brandId, async () => {
          if (imagesLeft <= 0) return { error: `image budget exhausted (max ${budget.images})` };
          imagesLeft -= 1;
          try {
            const { composeAndRenderGraphic, withBrandKitLogos } = await import('$lib/server/design-compose');
            const { resolveTypography } = await import('$lib/design/typography');
            const { latestGraphic, saveGraphicVersion, versionSource } = await import('$lib/server/design-store');
            const { isUrlSafe } = await import('$lib/server/brand-analysis');
            // Brand style off means the brand's own typography and art direction are off too.
            const type = useBrandStyle
              ? resolveTypography(kit)
              : { display: 'Inter', body: 'Inter', instructions: '' };

            const available: Array<{ url: string; label?: string | null }> = [];
            for (const u of opts.referenceUrls ?? []) {
              if (typeof u === 'string' && (u.startsWith('data:image/') || isUrlSafe(u))) {
                available.push({ url: u, label: 'reference photo' });
              }
            }
            if (opts.mediaIds?.length) {
              const { resolveBrandImageIds } = await import('$lib/server/brand-media');
              const urls = await resolveBrandImageIds(opts.supabase, opts.brandId, opts.mediaIds);
              for (const u of urls) {
                if (u && (u.startsWith('data:image/') || isUrlSafe(u))) available.push({ url: u, label: 'media library' });
              }
            }
            const catalog = withBrandKitLogos(available, {
              logos: kit?.logos,
              favicon_url: typeof kit?.favicon_url === 'string' ? kit.favicon_url : null
            }).slice(0, 10);

            const previous = editItemId
              ? await latestGraphic(opts.supabase, { kind: 'media_item', id: editItemId })
              : null;
            // The page offers a wider ratio set than a graphic canvas supports; anything the
            // renderer doesn't know becomes the 4:5 feed default rather than failing the call.
            const GRAPHIC_RATIOS = new Set(['1:1', '4:5', '9:16', '16:9']);
            const wanted = aspectIn ?? aspect;
            const ratio = (GRAPHIC_RATIOS.has(wanted) ? wanted : '4:5') as '1:1' | '4:5' | '9:16' | '16:9';

            const photoHint = available.length
              ? `\nUSER SELECTED PHOTO(S) are in AVAILABLE IMAGES (labels "reference photo" / "media library"). If the brief is about adding a logo or branding onto that photo, use that photo as a full-bleed background <img src="ref:N"> and place the "brand logo" as a small <img> — NEVER drop the photo for a blank white canvas with only the logo.`
              : '';

            const composeOpts = {
              brandId: opts.brandId,
              userId: opts.userId,
              instructions: type.instructions,
              availableImages: catalog
            };
            const composed = await composeAndRenderGraphic(previous ? brief + photoHint : brief, {
              ...composeOpts,
              previousSource: previous ? versionSource(previous) : null,
              context: previous ? null : `Requested aspect ratio: ${ratio}.${photoHint}`,
              render: {
                brandColors: useBrandStyle ? ((kit?.brand_colors as string[] | null) ?? null) : null,
                typography: { display: type.display, body: type.body },
                availableImages: catalog
              }
            });
            const out = composed.rendered;
            const url = await uploadPostImage(
              opts.supabase,
              opts.userId,
              `data:image/png;base64,${out.png.toString('base64')}`
            );
            if (!url) return { error: 'Upload failed' };

            // An edit stays on the SAME grid item so its history is one chain, not a pile of takes.
            const id = editItemId ?? (await persistItem('image', url, brief, out.aspect));
            // La tessera deve mostrare la revisione: salvare storage + versione senza aggiornare
            // `media_generator_items.url` lasciava in griglia l'immagine vecchia — l'edit
            // "riusciva" e non si vedeva da nessuna parte.
            let tileWarning: string | undefined;
            if (editItemId) {
              const { updateMediaGeneratorItemUrl } = await import('$lib/server/media-generator/persist');
              const upd = await updateMediaGeneratorItemUrl(opts.supabase, {
                brandId: opts.brandId,
                itemId: editItemId,
                url,
                prompt: brief
              });
              if (!upd.ok) {
                tileWarning = `The revised image is saved (url below) but the grid tile could not be updated: ${upd.error}. Tell the user the new version exists at that url.`;
              }
            }
            if (id) {
              await saveGraphicVersion(opts.supabase, {
                brandId: opts.brandId,
                userId: opts.userId,
                target: { kind: 'media_item', id },
                spec: out.spec,
                source: out.source,
                mediaUrl: url,
                brief
              });
            }
            produced.push({ type: 'image', url, prompt: brief, id });
            return {
              ok: true,
              type: 'image' as const,
              url,
              prompt: brief,
              id,
              editable: true,
              ...(composed.issues.length ? { design_warnings: composed.issues.map((i) => i.detail) } : {}),
              ...(tileWarning ? { warning: tileWarning } : {})
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        });
      }
    }),

    finish: tool({
      description: 'Complete the run and summarize what was produced (include Case A/B and which Refs were edited, if any).',
      inputSchema: z.object({
        summary: z.string().describe('Short summary of what was generated')
      }),
      execute: async ({ summary }) => {
        // Le guardie condivise: l'obiettivo che l'agente si è scritto, e la review delegata.
        const refusal = await base.guardFinish();
        if (refusal) return refusal;
        return {
          ok: true,
          summary,
          media: produced,
          ...(base.reviewSkipped()
            ? {
                unreviewed: true,
                tell_the_user: 'Say plainly that there was no time left for an independent review.'
              }
            : {})
        };
      }
    })
  });

  const t0 = Date.now();
  // Multimodal user turn: the planner must SEE the selected photos, labeled Ref N —
  // otherwise multi-ref edits collapse onto the first image only.
  const userContent: Array<
    { type: 'text'; text: string } | { type: 'image'; image: string | URL } | MediaPart
  > = [
    {
      type: 'text',
      text: referenceParts.length
        ? `${opts.prompt.trim()}

[${referenceParts.length} reference image(s) attached below as Ref 0…Ref ${referenceParts.length - 1}.
Variants setting = ${variants} (takes PER targeted ref when editing; total results when inventing new).
If editing attached photos, call generate_image once per target × variants with the matching baseRefIndex.]`
        : opts.prompt.trim()
    }
  ];
  for (let i = 0; i < referenceParts.length; i++) {
    const p = referenceParts[i]!;
    userContent.push({ type: 'text', text: `Ref ${i}:` });
    userContent.push({
      type: 'image',
      image: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
    });
  }
  // Images / clips the user linked in the prompt itself — text alone leaves the model blind to them.
  userContent.push(...(await resolveUserTurnMediaParts(opts.prompt)));

  const result = harnessStreamText({
    brandId: opts.brandId,
    userId: opts.userId,
    agent: 'media_generator',
    mode: `${kind}:v${variants}`,
    model: IMAGE_AGENT_MODEL(),
    provider: 'llm',
    surface: 'chat'
  }, {
    model: llmLanguageModel(IMAGE_AGENT_MODEL()),
    maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: userContent }],
    tools,
    stopWhen: [hasToolCall('finish'), stepCountIs(MAX_STEPS)],
    temperature: 0.4,
    abortSignal: opts.abortSignal,
    onFinish: ({ totalUsage }) => {
      // I file di questo turno se ne vanno con lui: la VM resta del brand, il workspace no.
      void base.close();
      logAiCall({
        label: 'media-generator',
        provider: 'llm',
        model: IMAGE_AGENT_MODEL(),
        ms: Date.now() - t0,
        ok: true,
        ...extractSdkUsage(totalUsage),
        brandId: opts.brandId,
        userId: opts.userId,
        context: `media-generator:${kind}:v${variants}:${useBrandStyle ? 'brand' : 'free'}:refs${referenceParts.length}:budget${budget.images}`
      });
    }
  });

  return result;
}
