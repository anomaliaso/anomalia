import IMAGE_PROMPTS_GUIDE from '$lib/agent-docs/how/WRITE-IMAGE-PROMPTS.md?raw';
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import type { GoogleGenAI } from '@google/genai';
import { generateText, tool, stepCountIs, hasToolCall, type StopCondition } from 'ai';
import { resolveUserTurnMediaParts } from '$lib/media-parts';
import { createHarnessSession } from '$lib/server/harness/session';
import { persistHarnessSession } from '$lib/server/harness/persist';
import { wrapTools } from '$lib/server/harness/pipeline';
import { applyStewardPrepareStep, createSessionSteward } from '$lib/server/harness/steward';
import { z } from 'zod';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { fetchImagePart } from '$lib/server/brand-context';
import { computeCostUsd, extractSdkUsage, getBrandPlanContext, logAiCall, setBrandPlanContext, withBrandContext } from '$lib/server/ai-log';
import { geminiVisualCreditShare, makeGenaiClient } from '$lib/server/gemini';
import { llmDefaultModel, llmLanguageModel } from '$lib/server/llm';
import { getCreditsUsage, type Brand } from '$lib/server/credits';
import { createAdminClient } from '$lib/server/supabase-admin';
import { listBrandMedia, publishLibraryImageAsPostMedia } from '$lib/server/brand-media';
import { signKnowledgePaths } from '$lib/server/media-archive';
import { signPersonImages } from '$lib/server/people';
import {
  aspectRatioFor,
  extractVisualPlaybook,
  loadBrandMoodImageUrls,
  loadCompetitorThumbUrls,
  renderPostImage,
  uploadPostImage,
  type AspectRatio
} from '$lib/server/content-preview';

// ── Image agent (Fase 0) ─────────────────────────────────────────────────────
// Server-side agentic loop for post images. Replaces renderWithQC on migrated call sites only.

export const IMAGE_AGENT_MODEL = llmDefaultModel;
export const MAX_AGENT_RENDERS = 4;
export const MAX_AGENT_INSPECTS = 2;
export const MAX_AGENT_STEPS = 50;
export const STALL_STEP_THRESHOLD = 3;
export const CONTEXT_IMAGE_MAX_PX = 768;
/**
 * Nano Banana Pro render at list — kept as the BUDGET estimate even though renders now default to
 * the cheaper Nano Banana 2 Lite: until Lite's credits are measured, Pro list is the prudent upper
 * bound, and real cost is in ai_calls from renderPostImage regardless.
 */
export const NANO_BANANA_PRO_LIST_RENDER_USD = 0.1386;

/**
 * In-loop budget estimate only (real cost is in ai_calls from renderPostImage).
 *
 * Since renders are billed at full list (geminiVisualCreditShare is always 1) this estimate is
 * ~3.7× what it was under the old plan discount, so PER_RUN_USD_CAP now buys proportionally
 * fewer renders per run. That is the point: the cap counts real money, not discounted money.
 */
export function estimatedRenderCostUsd(plan?: string | null): number {
  return NANO_BANANA_PRO_LIST_RENDER_USD * geminiVisualCreditShare(plan);
}
/** Max estimated USD the agent loop may spend in one run (on top of render-count cap). */
export const PER_RUN_USD_CAP = 2;
const CREDITS_PER_USD = 100;

type ImagePart = { inlineData: { mimeType: string; data: string } };

export type ImageAgentResult = {
  imageUrl?: string;
  imagePrompt: string;
  source: 'generated' | 'library';
  attempts: number;
  notes: string;
  /** In-loop estimate (Flash steps + render estimates). Actual billing is summed from ai_calls rows. */
  costUsd: number;
  /** Rounded costUsd × 100 — estimate only, may diverge from getCreditsUsage. */
  credits: number;
};

export type ImageAgentOpts = {
  supabase: SupabaseClient;
  userId: string;
  brandId: string;
  brief: string;
  platform: string | null;
  /** When set, overrides aspectRatioFor(platform) — e.g. standalone 9:16 without a platform. */
  aspectRatio?: AspectRatio;
  feedback?: string;
  baseImageUrl?: string | null;
  userRefUrls?: string[];
  /** Library media row ids the caller pinned for this run (chat generate_image media_ids). */
  pinnedLibraryMediaIds?: string[];
  productName?: string;
  personName?: string;
  productKind?: string;
  visualStyle?: string | null;
  brandLook?: string | null;
  visualPlaybook?: string | null;
  /** Official brand-kit logo (auto-loaded by generateStandaloneImage / regeneratePost). */
  logoImage?: ImagePart | null;
  /** When provided, used instead of reloading mood URLs from the DB. */
  moodImageUrls?: string[];
  budget?: { renders?: number; inspects?: number };
  deadlineMs?: number;
};

type AssetKind = 'library' | 'product' | 'person' | 'mood' | 'post' | 'competitor';

type AssetMeta = {
  id: string;
  kind: AssetKind;
  title: string;
  description?: string;
  when_to_use?: string;
  mood?: string;
  media_kind?: string;
  tags?: string[];
  subjects?: string[];
};

type AssetRecord = AssetMeta & {
  libraryId?: string;
  imageUrl?: string;
  productImages?: string[];
  productImageIndex?: number;
  personId?: string;
  referenceMode?: 'product' | 'ui';
};

type BestResult = {
  imageUrl?: string;
  imagePrompt: string;
  source: 'generated' | 'library';
  notes: string;
};

export type AgentBudget = {
  rendersLeft: number;
  inspectsLeft: number;
  usdRemaining: number;
  usdSpent: number;
  // Per-step token totals, accumulated as the loop runs. generateText only exposes totalUsage on a
  // SUCCESSFUL return, so a run that throws would otherwise log no usage at all → cost_usd null →
  // excluded from getCreditsUsage, i.e. a failed run bills nothing even though its renders already
  // cost real money. These let the finally-block log what the completed steps actually consumed.
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  tokensThinking: number;
};

/** Opt-out: IMAGE_AGENT_ENABLED=false falls back to renderWithQC. Default ON. */
export function isImageAgentEnabled(): boolean {
  return env.IMAGE_AGENT_ENABLED !== 'false';
}

export function createAgentBudget(opts?: {
  renders?: number;
  inspects?: number;
  usdRemaining?: number;
}): AgentBudget {
  return {
    rendersLeft: opts?.renders ?? MAX_AGENT_RENDERS,
    inspectsLeft: opts?.inspects ?? MAX_AGENT_INSPECTS,
    usdRemaining: opts?.usdRemaining ?? Number.POSITIVE_INFINITY,
    usdSpent: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    tokensThinking: 0
  };
}

/** Enforce render budget inside the tool executor — not in the prompt. */
export function consumeRenderBudget(budget: AgentBudget): { ok: true } | { ok: false; error: string } {
  if (budget.rendersLeft <= 0) {
    return { ok: false, error: `render_image budget exhausted (max ${MAX_AGENT_RENDERS} per run)` };
  }
  if (budget.usdRemaining <= 0) {
    return { ok: false, error: 'USD budget exhausted for this image-agent run' };
  }
  budget.rendersLeft -= 1;
  return { ok: true };
}

export function consumeInspectBudget(budget: AgentBudget): { ok: true } | { ok: false; error: string } {
  if (budget.inspectsLeft <= 0) {
    return { ok: false, error: `inspect_assets budget exhausted (max ${MAX_AGENT_INSPECTS} per run)` };
  }
  budget.inspectsLeft -= 1;
  return { ok: true };
}

export function addStepCost(budget: AgentBudget, rawUsage: unknown): number {
  const usage = extractSdkUsage(rawUsage);
  const stepUsd =
    computeCostUsd({
      label: 'image-agent-step',
      provider: 'llm',
      model: IMAGE_AGENT_MODEL(),
      ms: 0,
      ok: true,
      ...usage
    }) ?? 0;
  budget.usdSpent += stepUsd;
  budget.usdRemaining = Math.max(0, budget.usdRemaining - stepUsd);
  budget.tokensIn += usage.inputTokens ?? 0;
  budget.tokensOut += usage.outputTokens ?? 0;
  budget.tokensCached += usage.cachedTokens ?? 0;
  budget.tokensThinking += usage.thinkingTokens ?? 0;
  return stepUsd;
}

export function addRenderCostEstimate(budget: AgentBudget): void {
  const usd = estimatedRenderCostUsd(getBrandPlanContext());
  budget.usdSpent += usd;
  budget.usdRemaining = Math.max(0, budget.usdRemaining - usd);
}

/** True when the last `threshold` state fingerprints are identical (agent stalled). */
export function stallDetected(recentFingerprints: string[], threshold = STALL_STEP_THRESHOLD): boolean {
  if (recentFingerprints.length < threshold) return false;
  const tail = recentFingerprints.slice(-threshold);
  return tail.every((h) => h === tail[0]);
}

/** Keeps the base system prompt and appends the per-step budget line (prepareStep must not replace). */
export function appendBudgetToSystem(baseSystem: string, budgetLine: string): string {
  return `${baseSystem}\n\n--- Run budget ---\n${budgetLine}`;
}

export function buildPrepareStepSystem(
  baseSystem: string,
  budget: AgentBudget,
  maxRenders: number,
  maxInspects: number,
  remainingSec: number
): string {
  const budgetLine = `Renders left: ${budget.rendersLeft}/${maxRenders}. Inspects left: ${budget.inspectsLeft}/${maxInspects}. USD left (estimate): ~$${budget.usdRemaining.toFixed(3)}. Time left: ~${remainingSec}s.`;
  return appendBudgetToSystem(baseSystem, budgetLine);
}

export function capRunUsdBudget(brandRemainingCredits: number, perRunCap = PER_RUN_USD_CAP): number {
  return Math.min(Math.max(0, brandRemainingCredits / CREDITS_PER_USD), perRunCap);
}

function fingerprint(best: BestResult | null, budget: AgentBudget): string {
  return JSON.stringify({
    url: best?.imageUrl ?? '',
    prompt: best?.imagePrompt ?? '',
    source: best?.source ?? '',
    r: budget.rendersLeft,
    i: budget.inspectsLeft
  });
}

function genaiClient(): GoogleGenAI {
  return makeGenaiClient();
}

async function downscaleForContext(dataUrl: string): Promise<{ mediaType: string; data: string }> {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid image data URL');
  const buf = Buffer.from(m[2], 'base64');
  const out = await sharp(buf)
    .resize({ width: CONTEXT_IMAGE_MAX_PX, height: CONTEXT_IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { mediaType: 'image/jpeg', data: out.toString('base64') };
}

function modelOutputWithImages(text: string, dataUrls: string[]) {
  return async () => {
    const imgs = await Promise.all(dataUrls.map((u) => downscaleForContext(u)));
    return {
      type: 'content' as const,
      value: [
        { type: 'text' as const, text },
        // 'image-data', non 'file-data': Google li mappa entrambi su inlineData, ma il
        // provider OpenAI-compat (Luna via kie — il default della chat) mappa 'file-data' su
        // input_file (documento) e solo 'image-data' su input_image. Con 'file-data' il
        // modello "recensiva" immagini che non aveva mai visto.
        ...imgs.map((img) => ({ type: 'image-data' as const, mediaType: img.mediaType, data: img.data }))
      ]
    };
  };
}

/**
 * IL PEZZO CHE MANCAVA: il prompt di sistema sapeva GIUDICARE un'immagine e non sapeva SCRIVERNE
 * una. La checklist di QC qui sotto boccia il render generico (punto 5) senza dire da nessuna
 * parte come si evita — e la si evita con la terminologia fotografica, che è quello che la guida
 * porta. Sta inline e non dietro un `read_file` perché questo loop non ha file da leggere.
 */
export const IMAGE_PROMPT_GUIDE = IMAGE_PROMPTS_GUIDE.trim();

// critiqueImage checklist — copied verbatim from content-preview.ts (do not paraphrase).
const CRITIQUE_CHECKLIST = `1. PRODUCT FIDELITY: does the generated product match the REAL product reference (shape, TRUE colours, materials, finish, branding)? It must NOT be desaturated to greyscale, recoloured, redesigned, or swapped for a similar object.
2. PERSON FIDELITY: if a person should appear, they must look like the attached person REFERENCE photo(s) — same face, gender presentation, approximate age, hair. FAIL if the generated person clearly contradicts the references (e.g. wrong gender presentation vs the photos). Place them NATURALLY in the scene (not pasted into a reflection, not floating, not duplicated).
3. COMPOSITION: is it a believable, attractive product photo? Flag unnatural framing — e.g. the product reflected strangely, a person/animal appearing from nowhere, wrong scale (a macro crop of a large item), a repetitive "object on dark textured stone" stock backdrop, or obvious AI artifacts.
4. APPEAL: would this stop the scroll and look premium/on-brand?
5. GENERIC AI/STOCK LOOK: does it read as a generic AI render or interchangeable stock photo — over-saturated HDR glow, waxy skin, 3D-render sheen, sterile posing, garbled text, an image that could belong to any brand's feed? FAIL it if so: "technically correct but generic" is not publish-ready.
6. BRAND VISUAL STYLE: does the image match the brand's visual brief? Check palette, lighting, composition, mood, graphic language. Flag any deviation that makes this image feel off-brand.`;

function buildSystemPrompt(opts: ImageAgentOpts, aspect: AspectRatio): string {
  const feedbackLine = opts.feedback?.trim() ? `\nUser feedback on the current image: ${opts.feedback.trim()}` : '';
  const productLine = opts.productName ? `\nFeatured product: "${opts.productName}"${opts.productKind ? ` (${opts.productKind})` : ''}.` : '';
  const personLine = opts.personName ? `\nFeatured person: "${opts.personName}".` : '';
  const styleLine = opts.visualStyle?.trim() ? `\nBrand visual brief:\n${opts.visualStyle.trim()}` : '';
  const baseLine = opts.baseImageUrl
    ? `\nA BASE photo is attached on every render — edit that frame in place. Keep subject/scene/composition; apply only the brief (e.g. add the official brand logo). Never replace it with a blank canvas.`
    : '';
  return `You are an expert art-director agent that produces ONE publish-ready social post image.

Workflow:
1. search_assets to find relevant library photos, products, people, mood refs, past posts, competitor thumbs.
2. inspect_assets to LOOK at promising candidates before choosing references (max ${MAX_AGENT_INSPECTS} inspect calls, max 6 images each).
3. Either use_asset_as_is (real photo beats AI when appropriate) OR render_image with deliberate refs.
4. After each render_image, judge the result using this QC checklist:
${CRITIQUE_CHECKLIST}
5. If QC fails, change strategy — different refs, aspect, referenceMode, or use a real asset — not just rephrase the prompt.
6. Call finish when satisfied, or when budget is exhausted (use the best image you have).

Brief: ${opts.brief.trim()}${feedbackLine}${productLine}${personLine}${styleLine}${baseLine}
Target aspect ratio: ${aspect}.

Rules:
- Prefer a real library asset when it clearly fits the brief.
- The brand's official LOGO is attached on every render_image when available — reproduce THAT mark whenever branding/wordmark appears; never invent a different logo. On a candid photo with no branding, you may omit it.
- imagePrompt in finish must be non-empty when source is "generated".
- notes in finish: explain what you tried and what you changed.

${IMAGE_PROMPT_GUIDE}`;
}

async function loadAssetCatalog(
  supabase: SupabaseClient,
  brandId: string,
  moodImageUrls?: string[]
): Promise<Map<string, AssetRecord>> {
  const catalog = new Map<string, AssetRecord>();

  const lib = await listBrandMedia(supabase, brandId, { status: 'ready', limit: 80 });
  for (const r of lib) {
    const id = `library:${r.id}`;
    catalog.set(id, {
      id,
      kind: 'library',
      libraryId: r.id,
      title: r.title ?? r.file_name ?? 'Library asset',
      description: r.description ?? undefined,
      when_to_use: r.when_to_use ?? undefined,
      mood: r.mood ?? undefined,
      media_kind: r.media_kind ?? undefined,
      tags: r.tags ?? undefined,
      subjects: r.subjects ?? undefined,
      imageUrl: r.signed_url ?? undefined
    });
  }

  const { data: products } = await supabase
    .from('products')
    .select('id, title, description, images')
    .eq('brand_id', brandId)
    .limit(400);
  for (const p of products ?? []) {
    const images = Array.isArray(p.images) ? p.images.map(String).filter(Boolean).slice(0, 3) : [];
    images.forEach((url, idx) => {
      const id = `product:${p.id}:${idx}`;
      catalog.set(id, {
        id,
        kind: 'product',
        title: String(p.title ?? 'Product'),
        description: String(p.description ?? ''),
        media_kind: 'product',
        subjects: [String(p.title ?? '')],
        productImages: images,
        productImageIndex: idx,
        imageUrl: url,
        referenceMode: 'product'
      });
    });
  }

  const { data: people } = await supabase
    .from('people')
    .select('id, name, role, description, images')
    .eq('brand_id', brandId)
    .limit(20);
  await Promise.all(
    (people ?? []).map(async (person) => {
      const signed = await signPersonImages(supabase, (person.images ?? []) as { path: string }[]);
      signed.slice(0, 2).forEach((url, idx) => {
        const id = `person:${person.id}:${idx}`;
        catalog.set(id, {
          id,
          kind: 'person',
          personId: person.id,
          title: String(person.name ?? 'Person'),
          description: [person.role, person.description].filter(Boolean).join(' — ') || undefined,
          media_kind: 'person',
          subjects: [String(person.name ?? '')],
          imageUrl: url
        });
      });
    })
  );

  const moodUrls = moodImageUrls?.length ? moodImageUrls : await loadBrandMoodImageUrls(supabase, brandId);
  moodUrls.forEach((url, idx) => {
    const id = `mood:${idx}`;
    catalog.set(id, {
      id,
      kind: 'mood',
      title: `Brand mood reference ${idx + 1}`,
      description: 'Brand style/mood reference shot',
      media_kind: 'photo',
      imageUrl: url
    });
  });

  const { data: history } = await supabase
    .from('social_post_history')
    .select('id, content, thumbnail_path, thumbnail_url')
    .eq('brand_id', brandId)
    .order('published_at', { ascending: false })
    .limit(20);
  const paths = (history ?? []).map((h) => String(h.thumbnail_path ?? '')).filter(Boolean);
  const signedHist = paths.length ? await signKnowledgePaths(supabase, paths) : new Map<string, string>();
  for (const h of history ?? []) {
    const url =
      (h.thumbnail_path ? signedHist.get(String(h.thumbnail_path)) : null) ??
      (h.thumbnail_url ? String(h.thumbnail_url) : null);
    if (!url) continue;
    const id = `post:${h.id}`;
    catalog.set(id, {
      id,
      kind: 'post',
      title: 'Past brand post',
      description: String(h.content ?? '').slice(0, 200) || undefined,
      media_kind: 'photo',
      imageUrl: url
    });
  }

  const competitorUrls = await loadCompetitorThumbUrls(supabase, brandId);
  competitorUrls.forEach((url, idx) => {
    const id = `competitor:${idx}`;
    catalog.set(id, {
      id,
      kind: 'competitor',
      title: `Competitor reference ${idx + 1}`,
      description: 'Competitor top-post thumbnail (anti-moodboard)',
      media_kind: 'photo',
      imageUrl: url
    });
  });

  return catalog;
}

function searchCatalog(catalog: Map<string, AssetRecord>, query: string, kinds: AssetKind[]): AssetMeta[] {
  const needle = query.trim().toLowerCase();
  const allowed = kinds.length ? new Set(kinds) : null;
  const scored: { meta: AssetMeta; score: number }[] = [];
  for (const rec of catalog.values()) {
    if (allowed && !allowed.has(rec.kind)) continue;
    const hay = [
      rec.title,
      rec.description,
      rec.when_to_use,
      rec.mood,
      rec.media_kind,
      ...(rec.tags ?? []),
      ...(rec.subjects ?? [])
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    let score = 0;
    if (!needle) score = 1;
    else {
      for (const tok of needle.split(/\s+/).filter((t) => t.length > 2)) {
        if (hay.includes(tok)) score += 1;
      }
    }
    if (score > 0 || !needle) {
      const { libraryId: _l, imageUrl: _u, productImages: _p, productImageIndex: _i, personId: _pid, referenceMode: _rm, ...meta } = rec;
      scored.push({ meta, score: score || 0.1 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 24).map((s) => s.meta);
}

async function resolveRefParts(
  catalog: Map<string, AssetRecord>,
  ids: string[]
): Promise<{ product?: ImagePart[]; person?: ImagePart[]; mood?: ImagePart[]; user?: ImagePart[]; reference?: ImagePart[]; referenceMode?: 'product' | 'ui' }> {
  const product: ImagePart[] = [];
  const person: ImagePart[] = [];
  const mood: ImagePart[] = [];
  const reference: ImagePart[] = [];
  let referenceMode: 'product' | 'ui' | undefined;
  for (const id of ids.slice(0, 8)) {
    const rec = catalog.get(id);
    if (!rec?.imageUrl) continue;
    const part = await fetchImagePart(rec.imageUrl);
    if (!part) continue;
    if (rec.kind === 'product') {
      reference.push(part);
      referenceMode = rec.referenceMode ?? 'product';
    } else if (rec.kind === 'person') person.push(part);
    else if (rec.kind === 'mood') mood.push(part);
    else reference.push(part);
  }
  return {
    product: product.length ? product : undefined,
    person: person.length ? person : undefined,
    mood: mood.length ? mood : undefined,
    reference: reference.length ? reference : undefined,
    referenceMode
  };
}

async function fetchUsdBudget(brandId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data: brand } = await admin.from('brands').select('id, plan, activated_at, status').eq('id', brandId).maybeSingle();
    if (!brand) return PER_RUN_USD_CAP;
    setBrandPlanContext((brand as Brand).plan);
    const usage = await getCreditsUsage(admin, brand as Brand);
    return capRunUsdBudget(usage.remaining);
  } catch {
    return PER_RUN_USD_CAP;
  }
}

export async function runImageAgent(opts: ImageAgentOpts): Promise<ImageAgentResult> {
  return withBrandContext(opts.brandId, () => runImageAgentInner(opts));
}

async function runImageAgentInner(opts: ImageAgentOpts): Promise<ImageAgentResult> {
  const aspect = opts.aspectRatio ?? aspectRatioFor(opts.platform);
  const ai = genaiClient();
  const catalog = await loadAssetCatalog(opts.supabase, opts.brandId, opts.moodImageUrls);
  const usdBudget = await fetchUsdBudget(opts.brandId);
  const maxRenders = opts.budget?.renders ?? MAX_AGENT_RENDERS;
  const maxInspects = opts.budget?.inspects ?? MAX_AGENT_INSPECTS;
  const budget = createAgentBudget({
    renders: maxRenders,
    inspects: maxInspects,
    usdRemaining: usdBudget
  });

  const baseSystem = buildSystemPrompt(opts, aspect);

  const outcome: { best: BestResult | null; finished: BestResult | null } = { best: null, finished: null };
  let attempts = 0;
  const stallFingerprints: string[] = [];
  const t0 = Date.now();
  const deadlineMs = opts.deadlineMs ?? 280_000;

  const baseImagePart = opts.baseImageUrl ? await fetchImagePart(opts.baseImageUrl) : null;
  const pinnedParts = opts.pinnedLibraryMediaIds?.length
    ? await (await import('$lib/server/brand-media')).loadLibraryMediaParts(
        opts.supabase,
        opts.brandId,
        opts.pinnedLibraryMediaIds
      )
    : [];
  const userRefParts = [
    ...pinnedParts,
    ...((await Promise.all((opts.userRefUrls ?? []).slice(0, 4).map((u) => fetchImagePart(u)))).filter(Boolean) as ImagePart[])
  ].slice(0, 4);

  // Every URL this run actually produced. `finish` takes an imageUrl straight from the model, which
  // is free to hand back a plausible URL it never minted — that lands on the post and 403s later.
  const mintedUrls = new Set<string>();
  const updateBest = (next: BestResult) => {
    if (next.imageUrl) mintedUrls.add(next.imageUrl);
    outcome.best = next;
    attempts += 1;
  };

  const tools = {
    search_assets: tool({
      description: 'Search brand assets by query. Returns metadata only — no images.',
      inputSchema: z.object({
        query: z.string().describe('What to look for'),
        kinds: z
          .array(z.enum(['library', 'product', 'person', 'mood', 'post', 'competitor']))
          .optional()
          .describe('Limit to these asset kinds')
      }),
      execute: async ({ query, kinds }) => {
        const results = searchCatalog(catalog, query, (kinds ?? []) as AssetKind[]);
        return { count: results.length, assets: results };
      }
    }),

    inspect_assets: tool({
      description: `Load up to 6 asset images into your context to inspect before using them. Budget: ${MAX_AGENT_INSPECTS} calls per run.`,
      inputSchema: z.object({
        ids: z.array(z.string()).min(1).max(6).describe('Asset ids from search_assets')
      }),
      execute: async ({ ids }) => {
        const gate = consumeInspectBudget(budget);
        if (!gate.ok) return { error: gate.error, ids };
        const urls: string[] = [];
        for (const id of ids) {
          const rec = catalog.get(id);
          if (rec?.imageUrl) urls.push(rec.imageUrl);
        }
        return { inspected: ids.length, loaded: urls.length, urls };
      },
      toModelOutput: async ({ output }) => {
        if (output && typeof output === 'object' && 'error' in output) {
          return { type: 'text', value: String((output as { error: string }).error) };
        }
        const urls = (output as { urls?: string[] }).urls ?? [];
        if (!urls.length) return { type: 'text', value: 'No images could be loaded for those ids.' };
        const dataUrls: string[] = [];
        for (const url of urls) {
          const part = await fetchImagePart(url);
          if (part) dataUrls.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
        }
        return (await modelOutputWithImages(`Inspected ${dataUrls.length} asset(s):`, dataUrls))();
      }
    }),

    render_image: tool({
      description: `Render a new image with Nano Banana (billed). Budget: ${MAX_AGENT_RENDERS} renders per run.`,
      inputSchema: z.object({
        prompt: z.string().describe('Image generation prompt'),
        aspect: z.enum(['1:1', '4:5', '9:16', '16:9']).optional(),
        refs: z.array(z.string()).optional().describe('Asset ids to use as references'),
        referenceMode: z.enum(['product', 'ui']).optional()
      }),
      execute: async ({ prompt, aspect: aspectIn, refs, referenceMode }) => {
        const gate = consumeRenderBudget(budget);
        if (!gate.ok) return { error: gate.error };
        const refParts = await resolveRefParts(catalog, refs ?? []);
        const dataUrl = await renderPostImage(ai, prompt, {
          referenceImages: refParts.reference,
          personImages: refParts.person,
          moodImages: refParts.mood,
          userRefImages: userRefParts.length ? userRefParts : undefined,
          logoImage: opts.logoImage ?? undefined,
          visualStyle: opts.visualStyle ?? undefined,
          visualPlaybook: opts.visualPlaybook ?? undefined,
          brandLook: opts.brandLook ?? undefined,
          baseImage: baseImagePart ?? undefined,
          aspectRatio: (aspectIn ?? aspect) as AspectRatio,
          referenceMode: referenceMode ?? refParts.referenceMode
        });
        if (!dataUrl) return { error: 'render_image returned no image' };
        addRenderCostEstimate(budget);
        const imageUrl = await uploadPostImage(opts.supabase, opts.userId, dataUrl, (aspectIn ?? aspect) as AspectRatio);
        updateBest({
          imageUrl: imageUrl ?? undefined,
          imagePrompt: prompt,
          source: 'generated',
          notes: `Rendered with ${refs?.length ?? 0} reference(s).`
        });
        return { ok: true, attempt: attempts, imageUrl, dataUrl };
      },
      toModelOutput: async ({ output }) => {
        if (output && typeof output === 'object' && 'error' in output) {
          return { type: 'text', value: String((output as { error: string }).error) };
        }
        const dataUrl = (output as { dataUrl?: string }).dataUrl;
        if (!dataUrl) return { type: 'text', value: 'Render failed.' };
        return (await modelOutputWithImages('Generated image — judge against the QC checklist:', [dataUrl]))();
      }
    }),

    use_asset_as_is: tool({
      description: 'Publish a library photo as the post image without AI generation.',
      inputSchema: z.object({
        id: z.string().describe('library:{uuid} asset id'),
        crop: z.boolean().optional()
      }),
      execute: async ({ id }) => {
        const rec = catalog.get(id);
        if (!rec || rec.kind !== 'library' || !rec.libraryId) {
          return { error: 'id must be a library asset (library:...)' };
        }
        const pub = await publishLibraryImageAsPostMedia(opts.supabase, {
          brandId: opts.brandId,
          userId: opts.userId,
          mediaId: rec.libraryId,
          platform: opts.platform
        });
        if ('error' in pub) return { error: pub.error };
        updateBest({
          imageUrl: pub.publicUrl,
          imagePrompt: opts.brief,
          source: 'library',
          notes: `Used library asset "${rec.title}" as-is.`
        });
        return { ok: true, imageUrl: pub.publicUrl, title: rec.title };
      }
    }),

    finish: tool({
      description: 'Complete the image-agent run with the chosen result.',
      inputSchema: z.object({
        imageUrl: z.string().optional(),
        imagePrompt: z.string(),
        notes: z.string()
      }),
      execute: async ({ imageUrl: pickedUrl, imagePrompt, notes }) => {
        // Only a URL this run minted counts; anything else is invented — fall back to the best render.
        const imageUrl = pickedUrl && mintedUrls.has(pickedUrl) ? pickedUrl : undefined;
        const source: 'generated' | 'library' =
          outcome.best?.source === 'library' && (!imageUrl || imageUrl === outcome.best.imageUrl) ? 'library' : 'generated';
        const resolvedPrompt =
          source === 'generated' ? (imagePrompt.trim() || outcome.best?.imagePrompt || opts.brief).trim() : imagePrompt.trim() || opts.brief;
        if (source === 'generated' && !resolvedPrompt) {
          return { error: 'imagePrompt is required when source is generated' };
        }
        const done: BestResult = {
          imageUrl: imageUrl ?? outcome.best?.imageUrl,
          imagePrompt: resolvedPrompt,
          source,
          notes: notes.trim() || outcome.best?.notes || ''
        };
        outcome.finished = done;
        return { ok: true, ...done };
      }
    })
  };

  const stallStop: StopCondition<typeof tools> = () => stallDetected(stallFingerprints, STALL_STEP_THRESHOLD);

  const loopT0 = Date.now();
  let result: { totalUsage?: unknown } | undefined;
  let loopOk = true;
  // Images / clips linked in the brief itself — otherwise the model is blind to them.
  const briefMedia = await resolveUserTurnMediaParts(opts.brief);
  let loopError: string | undefined;
  const messages = [
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: `Produce the best image for this brief. Start by searching assets relevant to: ${opts.brief.slice(0, 500)}`
        },
        // Any image or clip linked in the brief itself — otherwise the model is blind to it.
        ...briefMedia
      ]
    }
  ];
  const session = createHarnessSession({
    brandId: opts.brandId,
    userId: opts.userId,
    agent: 'image',
    mode: opts.platform ?? 'standalone',
    model: IMAGE_AGENT_MODEL(),
    provider: 'llm',
    surface: 'batch'
  });
  session.captureRequest({ system: baseSystem, messages });

  const steward = createSessionSteward(session, Object.keys(tools));
  const watchedTools = wrapTools(session, tools, steward.pipeline());

  try {
    result = await generateText({
      model: llmLanguageModel(),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      system: baseSystem,
      messages,
      allowSystemInMessages: true,
      tools: watchedTools,
      stopWhen: [hasToolCall('finish'), stepCountIs(MAX_AGENT_STEPS), stallStop],
      temperature: 0.35,
      prepareStep: () => {
        const elapsed = Date.now() - t0;
        const remainingSec = Math.max(0, Math.round((deadlineMs - elapsed) / 1000));
        const stepSystem = buildPrepareStepSystem(baseSystem, budget, maxRenders, maxInspects, remainingSec);
        const step =
          budget.usdRemaining <= 0 && outcome.best
            ? { toolChoice: { type: 'tool' as const, toolName: 'finish' }, system: stepSystem }
            : { system: stepSystem };
        const patched = applyStewardPrepareStep(session, steward, step, baseSystem) ?? {};
        session.capturePrepareStep(patched);
        return patched;
      },
      onStepFinish: (event) => {
        session.recordStep(event);
        if (event.usage) addStepCost(budget, event.usage);
        stallFingerprints.push(fingerprint(outcome.best, budget));
      }
    });
    session.recordAssistantText(result.text);
    session.recordUsage(result.totalUsage ?? result.usage);
    session.finish('finished');
  } catch (e) {
    session.finish('failed', e);
    loopOk = false;
    loopError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    persistHarnessSession(session);
    const totalUsage = extractSdkUsage(result?.totalUsage);
    logAiCall({
      label: 'image-agent',
      provider: 'llm',
      model: IMAGE_AGENT_MODEL(),
      ms: Date.now() - loopT0,
      ok: loopOk,
      error: loopError,
      // A run that THREW leaves `result` undefined and loses totalUsage, so fall back to what
      // onStepFinish accumulated across the completed steps. Without this the row carries no usage
      // → computeCostUsd returns null → getCreditsUsage filters it out, and a failed run bills the
      // brand nothing even though the renders it already fired cost real money.
      inputTokens: totalUsage.inputTokens ?? budget.tokensIn,
      outputTokens: totalUsage.outputTokens ?? budget.tokensOut,
      cachedTokens: totalUsage.cachedTokens ?? budget.tokensCached,
      thinkingTokens: totalUsage.thinkingTokens ?? budget.tokensThinking,
      brandId: opts.brandId,
      userId: opts.userId,
      context: 'image-agent'
    });
  }

  const resolved = outcome.finished ?? outcome.best;
  if (!resolved) {
    return {
      imagePrompt: opts.brief,
      source: 'generated' as const,
      attempts,
      notes: 'Image agent finished without a result.',
      costUsd: budget.usdSpent,
      credits: Math.round(budget.usdSpent * CREDITS_PER_USD)
    };
  }

  const imagePrompt =
    resolved.source === 'generated'
      ? (resolved.imagePrompt.trim() || opts.brief).trim()
      : resolved.imagePrompt.trim() || opts.brief;

  return {
    imageUrl: resolved.imageUrl,
    imagePrompt,
    source: resolved.source,
    attempts,
    notes: resolved.notes,
    costUsd: budget.usdSpent,
    credits: Math.round(budget.usdSpent * CREDITS_PER_USD)
  };
}
