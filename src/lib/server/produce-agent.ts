import { maxOutputTokensFor } from '$lib/server/ai-output-limits';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOpenAI } from '@ai-sdk/openai';
import {
  tool,
  stepCountIs,
  hasToolCall,
  type LanguageModel,
  type ModelMessage
} from 'ai';
import { generateText } from 'ai';
import { createHarnessSession } from '$lib/server/harness/session';
import { persistHarnessSession } from '$lib/server/harness/persist';
import { wrapTools } from '$lib/server/harness/pipeline';
import { applyStewardPrepareStep, createSessionSteward } from '$lib/server/harness/steward';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { fetchImagePart } from '$lib/server/brand-context';
import { extractSdkUsage, logAiCall, withBrandContext } from '$lib/server/ai-log';
import { llmConfigured, llmDefaultModel, llmLanguageModel } from '$lib/server/llm';
import { persistAgentRun, type AgentStepLog } from '$lib/server/agent-runs';
import { groundedText } from '$lib/server/research';
import { analyzePostHistory, historyInsightsDigest } from '$lib/server/post-history-insights';
import { loadOwnPostHistory } from '$lib/server/own-post-history';
import { benchmarkDigest, type Benchmark } from '$lib/server/research';
import {
  readBrandStudioForAgent,
  readEditorialPlanForAgent,
  readGtmForAgent,
  readKnowledgeForAgent,
  readLeadsForAgent,
  readMediaForAgent,
  readRubricsForAgent,
  readStrategyReportForAgent,
  readVisualInsightsForAgent
} from '$lib/server/strategy-agent-reads';
import { ensureMarketReferences, formatMarketBrief } from '$lib/server/market-references';
import { upcomingTimelyHooks } from '$lib/server/thematic-calendar';
import { KIE_GROK_NO_STORE, KIE_MODEL, kieFetch } from '$lib/server/kie';
import { ensureShortNetworkCuts } from '$lib/platform-limits';
import {
  seedToPost,
  renderPreviewImages,
  collectBatchReviewImages,
  CAPTION_FAILURE_MODES,
  ownerEditPairsBlock,
  type ContentPrefs,
  type PastWinner,
  type PreviewPost,
  type WeeklyStrategy
} from '$lib/server/content-preview';
import {
  assertHashtagPrefs,
  assertRedditCraft,
  winningPatternsBlock,
  VISUAL_WINNERS_NO_DATA
} from '$lib/server/platform-hygiene';

/**
 * Produce agent + multimodal reviewer loop (Grok 4.5 via kie).
 *
 * Replaces the fixed executePlan → reviewCaptions pipeline unless PRODUCE_AGENT_ENABLED=false.
 * The produce agent researches (web, market trends, history, brand studio…) then submits a
 * justified batch. Images are rendered. The reviewer sees captions + images and either
 * approves or sends feedback. On reject, the produce agent CONTINUES the same conversation
 * with the reviewer notes (max PRODUCE_MAX_ROUNDS rounds).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;
type BrandProfile = AnyRec;

export const PRODUCE_MAX_ROUNDS = 4;
export const PRODUCE_AGENT_MAX_STEPS = 40;
export const PRODUCE_REVIEWER_MAX_STEPS = 12;
const SEARCH_BUDGET = 10;

/** Opt-out: PRODUCE_AGENT_ENABLED=false falls back to legacy executePlan. Default ON. */
export function produceAgentEnabled(): boolean {
  return env.PRODUCE_AGENT_ENABLED !== 'false';
}

export type PostCraft = {
  index: number;
  caption: string;
  image_prompt: string;
  /** Carousel only: one prompt per slide; index 0 == image_prompt. */
  slide_prompts?: string[];
  title?: string;
  /** Reddit target without r/ — required for reddit seeds. */
  subreddit?: string;
  justification: string;
  /** Una riga: perché ha deviato dalla scena proposta dal seed (contratto a due livelli). */
  scene_deviation?: string;
  x_caption?: string;
  threads_caption?: string;
  alt_captions?: string[];
  first_comment?: string;
};

export type ProduceAgentResult = {
  posts: PreviewPost[];
  batchJustification: string;
  rounds: number;
  approved: boolean;
  produceSteps: AgentStepLog[];
  reviewSteps: AgentStepLog[];
  reviewSummary: string;
};

export type ProduceAgentOpts = {
  supabase: SupabaseClient;
  userId: string;
  brandId: string;
  profile: BrandProfile;
  strategy: WeeklyStrategy;
  prefs?: ContentPrefs;
  maxVideos?: number;
  maxCarousels?: number;
  timezone?: string;
  strategyBrief?: string;
  /** Preloaded winners — when absent, produce loads from social_post_history (OWN posts only). */
  topPosts?: PastWinner[];
  onProgress?: (step: string, message: string) => void;
  deadlineMs?: number;
};

function grokModel(): { model: LanguageModel; provider: 'kie'; modelId: string } | null {
  if (!env.KIE_API_KEY) return null;
  const kie = createOpenAI({
    baseURL: 'https://api.kie.ai/grok/v1',
    apiKey: env.KIE_API_KEY,
    name: 'kie',
    fetch: kieFetch()
  });
  return { model: kie.responses(KIE_MODEL), provider: 'kie', modelId: KIE_MODEL };
}

function llmFallback(): { model: LanguageModel; provider: 'llm'; modelId: string } {
  return { model: llmLanguageModel(), provider: 'llm', modelId: llmDefaultModel() };
}

function resolveModel() {
  return grokModel() ?? llmFallback();
}

function seedBrief(strategy: WeeklyStrategy): string {
  return strategy.seeds
    .map((s, i) => {
      const meta = [
        s.platform,
        s.format,
        s.product ? `product:${s.product}` : '',
        s.pillar ? `pillar:${s.pillar}` : '',
        s.subreddit ? `subreddit:r/${s.subreddit}` : '',
        s.title ? `title:${s.title}` : ''
      ]
        .filter(Boolean)
        .join(' · ');
      return `${i}. [${meta}] angle: ${s.angle}\n   proposed scene → subject: ${s.subject} | setting: ${s.setting} | props: ${s.props}`;
    })
    .join('\n');
}

function hashtagPrefsBlock(prefs: ContentPrefs): string {
  const map = prefs.platformHashtags ?? {};
  const entries = Object.entries(map).filter(([, tags]) => Array.isArray(tags) && tags.some(Boolean));
  if (!entries.length) {
    return `HASHTAG PREFS: none set per platform. Prefer zero or very few native tags; never spam. Invented trend-chasing tags are usually wrong.`;
  }
  const lines = entries.map(
    ([plat, tags]) =>
      `- ${plat}: ONLY these approved tags (exact spelling) — ${(tags as string[]).filter(Boolean).join(' ')} — or omit hashtags entirely. NEVER invent/alter/translate tags outside this set.`
  );
  return `HASHTAG PREFS (authoritative when listed):\n${lines.join('\n')}`;
}

function platformPolicyBlock(prefs: ContentPrefs, strategy: WeeklyStrategy): string {
  const hasReddit = strategy.seeds.some((s) => platformIsReddit(s.platform));
  const reddit = hasReddit
    ? `REDDIT POLICY (hard):
- Pick a REAL, on-topic subreddit (no r/ prefix in the field). Prefer the seed's subreddit only if it truly fits the post's substance; otherwise change it and justify.
- Title is mandatory. Body must be community-native value first — guide, numbers, honest process — NOT an ad.
- Do NOT drop waitlist/product URLs, "check us out", or hard CTAs unless the sub explicitly allows self-promo AND the post would still stand without the link. Prefer no link; soft mention of a tool only after full value, or omit the brand URL entirely.
- Self-promo / link spam gets auto-removed or bans — wrong sub or off-theme promo is a fail.
- In justification: name the sub and why this post belongs there (and why it won't read as spam).`
    : '';
  return [hashtagPrefsBlock(prefs), reddit].filter(Boolean).join('\n\n');
}

function platformIsReddit(platform: string | null | undefined): boolean {
  return String(platform ?? '').toLowerCase().trim() === 'reddit';
}

function brandPersonality(prefs: ContentPrefs, profile: BrandProfile): string {
  const fromPlan = prefs.personality?.trim();
  if (fromPlan) return fromPlan;
  const fromVoice = prefs.voiceFramework?.character?.trim();
  if (fromVoice) return fromVoice;
  const ai = profile?.ai_character;
  if (ai && typeof ai === 'object') {
    const line = [ai.personality, ai.character, ai.tone].filter(Boolean).map(String).join(' · ').trim();
    if (line) return line;
  }
  return '';
}

/** Zip agent crafts onto strategy seeds. Exported for unit tests. */
export function applyProduceCraft(
  strategy: WeeklyStrategy,
  crafts: PostCraft[],
  prefs: ContentPrefs = {}
): PreviewPost[] {
  return strategy.seeds.map((seed, i) => {
    const post = seedToPost(seed);
    const c = crafts.find((x) => x.index === i) ?? crafts[i];
    if (!c) return post;
    post.caption = String(c.caption ?? '').trim();
    post.image_prompt = post.media === 'text' || post.media === 'link' ? '' : String(c.image_prompt ?? '').trim();
    if (post.format === 'carousel') {
      const slides = Array.isArray(c.slide_prompts)
        ? c.slide_prompts.map(String).map((s) => s.trim()).filter(Boolean)
        : [];
      const want = Math.max(2, Number(seed.slide_count ?? slides.length) || 0);
      if (slides.length >= 2) {
        const trimmed = slides.slice(0, Math.max(want, slides.length));
        post.image_prompts = trimmed;
        post.image_prompt = trimmed[0];
      }
    }
    if (c.title) post.title = String(c.title);
    if (platformIsReddit(post.platform)) {
      const sub = (c.subreddit || seed.subreddit || '').replace(/^r\//i, '').trim();
      if (sub) post.subreddit = sub;
      if (!post.title && seed.title) post.title = seed.title;
    }
    post.justification = String(c.justification ?? '').trim();
    // Contratto a due livelli: la deviazione dichiarata viaggia fino a posts.qc.scene_deviation.
    const dev = String(c.scene_deviation ?? '').trim();
    if (dev) post.sceneDeviation = dev;
    if (Array.isArray(c.alt_captions)) post.alt_captions = c.alt_captions.map(String).filter(Boolean).slice(0, 2);
    if (c.first_comment) post.first_comment = String(c.first_comment);
    const plats = Array.isArray(post.platforms) && post.platforms.length ? post.platforms : [post.platform];
    const cuts = ensureShortNetworkCuts(post.caption, plats, {
      ...(c.x_caption ? { x: c.x_caption } : {}),
      ...(c.threads_caption ? { threads: c.threads_caption } : {})
    });
    if (cuts) post.platform_captions = cuts;
    void prefs;
    return post;
  });
}

const PRODUCE_SYSTEM = `You are Anomalia's PRODUCE agent — research-led creative director for organic brand growth on social.

NORTH STAR (non-negotiable):
Grow this brand organically. Every caption and every image must earn attention, saves, shares, comments, follows, and profile visits — without paid boost. You are not filling a calendar; you are compounding reach and affinity. If a post would not stop a stranger mid-scroll or make a follower care enough to engage, it fails.

How you win:
1. Research first. Use read_* + search_web / read_market / read_post_history / read_timely_moments until you have evidence of what performs for THIS brand and what is moving in the market right now. If read_market is empty/stale it will refresh competitor scrape on the spot — wait for it.
2. Choose angles that serve growth: curiosity gaps, concrete proof, timely hooks, founder/human voice, useful specificity — never generic brand wallpaper.
3. Write for the algorithm AND the human: strong first line, native platform length/register, one clear idea, a reason to engage (comment, save, share, click).
4. Image briefs must be scroll-stopping scenes, on-brand, distinct from competitor clichés — the visual is half the organic bet. Each seed's subject/setting/props is the strategist's PROPOSAL, not an order: default to it, but when you have a genuinely stronger scene for that seed's angle, shoot yours and set scene_deviation (one line: why yours serves the angle better). Deviate on staging only — the seed's angle and pillar still rule, and every post's scene must stay distinct from the others. For CAROUSEL seeds, submit slide_prompts (N coherent standalone prompts; slide 1 = cover = image_prompt).
5. Platform hygiene is part of growth:
   - Hashtags: obey HASHTAG PREFS when set; otherwise minimal/native or none. Wrong or invented tags hurt reach.
   - Reddit: pick the right subreddit, stay on-theme, avoid link/self-promo spam that triggers auto-mod bans. Set subreddit + title on every Reddit post.
6. submit_batch with evidence-cited justifications: each post explains WHY this choice grows the brand (cite tools/data). For Reddit, justify the sub. For tagged platforms, justify hashtag choices (or why none). batch_justification must state the growth thesis for the whole batch.
7. Call finish after a successful submit_batch.

Rules:
- Do not invent facts, prices, awards, or pages.
- Honour brand personality, language, and platform length.
- Prefer what history/market say works over what sounds "on brand" in a vacuum.
- If you receive REVIEWER FEEDBACK, treat it as authoritative: revise only what failed, keep what passed, re-research if needed, then submit_batch again.
- Always end with finish().`;

const REVIEWER_SYSTEM = `You are Anomalia's PRODUCE REVIEWER — multimodal gatekeeper for organic brand growth.

NORTH STAR:
Approve only batches that would realistically help this brand grow organically (reach, engagement, affinity, follows). Reject polished-but-forgettable work. Correct language and pretty images are not enough if the post will not earn attention — or if it will get removed/banned.

Judge captions + images together:
- Growth: Would a stranger stop? Would a follower engage, save, or share? Is there a hook, a specific idea, a reason to care — or is it interchangeable brand filler?
- Caption: facts, language, platform register, originality, brand personality, no clichés/hype — and no AI tells: em-dash cadence (>1 —), tricolon endings, template openers ("Scopri…"/"Discover…"), empty superlatives without adjacent proof, emoji spray, or the same CTA formula closing two posts of the batch.
- Hashtags: if the brand set approved tags for that platform, reject any invented/altered tags outside the set. If none are set, reject spammy or off-topic tag piles; prefer few or none.
- Reddit: is the subreddit real and on-theme for THIS post? Would auto-mod remove it for self-promo / link spam / off-topic? Title + body must look like a member post. Wrong sub or waitlist-link spam = request_changes.
- Image: match to caption/angle, brand visual style, AI clichés, composition, text-in-image issues; is the visual distinctive enough to stop the scroll? For carousels, judge EVERY attached slide for series coherence.
- Coherence between caption and image.
- Justifications: evidence-based growth reasoning (not vibes). Flag justifications that do not explain how the post grows the brand (and for Reddit, why that sub).

Act:
- If the batch is strong enough to ship to the approval queue as organic growth assets → approve with a short summary of why it should grow.
- If anything material fails the growth bar (quality, facts, hashtags, Reddit safety) → request_changes with concrete per-post feedback the produce agent can act on.
- You may search_web to verify a claim or whether a subreddit fits / allows promo.
- Always end with approve or request_changes (then the loop stops your turn).`;

type Submitted = { crafts: PostCraft[]; batchJustification: string };

async function runProduceRound(opts: {
  model: LanguageModel;
  provider: 'kie' | 'llm';
  modelId: string;
  messages: ModelMessage[];
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  profile: BrandProfile;
  strategy: WeeklyStrategy;
  prefs: ContentPrefs;
  timezone: string;
  deadlineMs: number;
  /** Preloaded WINNING PATTERNS block (digest + top posts) — do not wait for the tool. */
  winningPatterns?: string;
  /** Preloaded VISUAL WINNERS block (brand_visual_insights) or '' when no own data yet. */
  visualInsights?: string;
  /** Preloaded MEDIA QC scores (Anomalia media reviewer). */
}): Promise<{ submitted: Submitted | null; messages: ModelMessage[]; steps: AgentStepLog[]; text: string }> {
  const submitted: { current: Submitted | null } = { current: null };
  const steps: AgentStepLog[] = [];
  let searches = 0;
  const t0 = Date.now();

  const tools = {
    read_brand_studio: tool({
      description: 'Brand kit, voice, products, people (free).',
      inputSchema: z.object({}),
      execute: async () => readBrandStudioForAgent(opts.supabase, opts.brandId)
    }),
    read_editorial_plan: tool({
      description: 'Active editorial plan (free).',
      inputSchema: z.object({}),
      execute: async () => readEditorialPlanForAgent(opts.supabase, opts.brandId, 'active')
    }),
    read_gtm: tool({
      description: 'Active GTM plan (free).',
      inputSchema: z.object({}),
      execute: async () => readGtmForAgent(opts.supabase, opts.brandId, opts.timezone, 'active')
    }),
    read_strategy_report: tool({
      description: 'Strategy / competitive report (free).',
      inputSchema: z.object({}),
      execute: async () => readStrategyReportForAgent(opts.supabase, opts.brandId)
    }),
    read_knowledge: tool({
      description: 'Brand documents and notes (free).',
      inputSchema: z.object({
        kind: z.enum(['note', 'document', 'image']).optional(),
        limit: z.number().int().min(1).max(40).optional()
      }),
      execute: async (input) => readKnowledgeForAgent(opts.supabase, opts.brandId, input)
    }),
    read_media: tool({
      description: 'Brand media library (free).',
      inputSchema: z.object({
        query: z.string().optional(),
        kind: z.enum(['image', 'video']).optional(),
        limit: z.number().int().min(1).max(40).optional()
      }),
      execute: async (input) => readMediaForAgent(opts.supabase, opts.brandId, input)
    }),
    read_rubrics: tool({
      description: 'Approved content series (free).',
      inputSchema: z.object({}),
      execute: async () => readRubricsForAgent(opts.supabase, opts.brandId, 'approved')
    }),
    read_leads: tool({
      description: 'Audience conversations / leads (free).',
      inputSchema: z.object({
        status: z.enum(['suggested', 'done', 'dismissed', 'all']).optional(),
        limit: z.number().int().min(1).max(40).optional()
      }),
      execute: async ({ status, limit }) =>
        readLeadsForAgent(opts.supabase, opts.brandId, { status: status ?? 'suggested', limit })
    }),
    read_post_history: tool({
      description:
        'Own post performance — aggregate digest + top posts WITH per-post numbers (likes, comments, views, engagementRate). Own posts only (Zernio-synced). Free.',
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await loadOwnPostHistory(opts.supabase, opts.brandId, { limit: 100 });
        const insights = analyzePostHistory(
          rows.map((h) => ({
            content: h.content,
            mediaType: h.media_type,
            publishedAt: h.published_at,
            metrics: h.metrics as AnyRec
          }))
        );
        const scored = (m: AnyRec | null | undefined) =>
          Number(m?.engagementRate ?? 0) || Number(m?.likes ?? 0) + Number(m?.comments ?? 0) * 2;
        const top = rows
          .slice()
          .sort(
            (a, b) =>
              scored(b.metrics as AnyRec) - scored(a.metrics as AnyRec)
          )
          .slice(0, 12)
          .map((h) => {
            const m = (h.metrics ?? {}) as AnyRec;
            return {
              platform: h.platform,
              media_type: h.media_type,
              published_at: h.published_at,
              caption: String(h.content ?? '').replace(/\s+/g, ' ').slice(0, 180),
              likes: Number(m.likes ?? 0),
              comments: Number(m.comments ?? 0),
              views: Number(m.views ?? m.impressions ?? 0),
              shares: Number(m.shares ?? 0),
              saves: Number(m.saves ?? 0),
              engagementRate: Number(m.engagementRate ?? 0)
            };
          });
        return {
          sample_size: rows.length,
          posts_with_metrics: rows.filter((h) => h.metrics && Object.keys(h.metrics as object).length).length,
          digest: historyInsightsDigest(insights),
          top_posts: top,
          ...(rows.length === 0
            ? {
                note:
                  'No OWN published posts with metrics yet (Zernio analytics not synced). Do not infer brand-specific winners — rely on read_market / read_competitors / search_web for market best practices.'
              }
            : {})
        };
      }
    }),
    read_visual_insights: tool({
      description:
        "Visual winners from THIS brand's own published posts — genres/platforms/asset sources/hook types with ER delta vs average (n≥3). Free.",
      inputSchema: z.object({}),
      execute: async () => {
        const block = await readVisualInsightsForAgent(opts.supabase, opts.brandId, { limit: 8 });
        if (!block.trim()) {
          return {
            visual_winners: null,
            note: "No own visual data yet — use the brief's recommended defaults."
          };
        }
        return { visual_winners: block };
      }
    }),
    read_competitors: tool({
      description: 'Competitor benchmark digest (free).',
      inputSchema: z.object({}),
      execute: async () => {
        const { data: strategy } = await opts.supabase
          .from('brand_strategy')
          .select('benchmark')
          .eq('brand_id', opts.brandId)
          .maybeSingle();
        const benchmark = (strategy?.benchmark as Benchmark | null) ?? null;
        return { digest: benchmark ? benchmarkDigest(benchmark) : 'No benchmark stored.' };
      }
    }),
    read_market: tool({
      description:
        'Market trending formats/hooks/angles from competitor socials. If missing/stale, refreshes scrape+catalog ON THE SPOT (may take a minute).',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const row = await ensureMarketReferences(opts.supabase, opts.brandId);
          const brief = formatMarketBrief(row);
          if (!brief) {
            return {
              brief: '',
              refreshed: true,
              error:
                'No market references available (no competitor handles to scrape, or refresh returned empty). Rely on read_post_history + read_competitors + search_web.'
            };
          }
          return {
            brief,
            refreshed: true,
            updated_at: row?.updated_at ?? null,
            sources: row?.sources?.slice(0, 12) ?? []
          };
        } catch (e) {
          return {
            brief: '',
            refreshed: false,
            error: e instanceof Error ? e.message : 'market refresh failed'
          };
        }
      }
    }),
    read_timely_moments: tool({
      description: 'Upcoming calendar / seasonal moments relevant to this brand.',
      inputSchema: z.object({}),
      execute: async () => {
        const hooks = await upcomingTimelyHooks({
          category: String(opts.profile?.category ?? ''),
          archetype: String(opts.profile?.site_type ?? ''),
          language: (opts.prefs.language || opts.profile?.language || '').trim() || undefined
        });
        return { hooks: hooks || 'No timely moments.' };
      }
    }),
    search_web: tool({
      description:
        'Live web search for trends, news, or fact checks. Budget-limited. Prefer read_market / read_post_history first.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        searches += 1;
        if (searches > SEARCH_BUDGET) return { error: `search budget exhausted (${SEARCH_BUDGET})` };
        const g = await groundedText(query, 'Answer with concrete, citable facts and recent trends.', {
          brandId: opts.brandId
        });
        return {
          answer: g.text.slice(0, 1500),
          sources: g.citations.slice(0, 5).map((c) => ({ uri: c.uri, title: c.title }))
        };
      }
    }),
    submit_batch: tool({
      description:
        'Submit the final batch craft: one entry per seed index with caption, image_prompt, and evidence-based justification.',
      inputSchema: z.object({
        batch_justification: z
          .string()
          .describe(
            'Growth thesis for the batch: how these posts together grow the brand organically, grounded in research.'
          ),
        posts: z.array(
          z.object({
            index: z.number().int(),
            caption: z.string(),
            image_prompt: z.string(),
            slide_prompts: z
              .array(z.string())
              .optional()
              .describe('Carousel only: N standalone slide prompts; slide 1 must match image_prompt.'),
            justification: z
              .string()
              .describe(
                'Why this caption/scene grows the brand organically — cite tools/data. For Reddit: why this sub. For hashtags: why these tags (or none) vs brand prefs.'
              ),
            scene_deviation: z
              .string()
              .optional()
              .describe(
                "ONLY when you replaced the seed's proposed scene (subject/setting/props) with a stronger one: ONE line saying why yours serves the angle better. Omit when you followed the proposal."
              ),
            title: z.string().optional().describe('Required for Reddit.'),
            subreddit: z
              .string()
              .optional()
              .describe('Reddit only: target sub WITHOUT r/ prefix. Required for Reddit posts.'),
            x_caption: z.string().optional(),
            threads_caption: z.string().optional(),
            alt_captions: z.array(z.string()).optional(),
            first_comment: z.string().optional()
          })
        )
      }),
      execute: async ({ batch_justification, posts }) => {
        const crafts: PostCraft[] = (posts ?? []).map((p) => ({
          index: Number(p.index),
          caption: String(p.caption ?? ''),
          image_prompt: String(p.image_prompt ?? ''),
          slide_prompts: Array.isArray(p.slide_prompts)
            ? p.slide_prompts.map(String).filter((s) => s.trim())
            : undefined,
          justification: String(p.justification ?? ''),
          scene_deviation: p.scene_deviation ? String(p.scene_deviation) : undefined,
          title: p.title ? String(p.title) : undefined,
          subreddit: p.subreddit ? String(p.subreddit).replace(/^r\//i, '').trim() : undefined,
          x_caption: p.x_caption ? String(p.x_caption) : undefined,
          threads_caption: p.threads_caption ? String(p.threads_caption) : undefined,
          alt_captions: Array.isArray(p.alt_captions) ? p.alt_captions.map(String) : undefined,
          first_comment: p.first_comment ? String(p.first_comment) : undefined
        }));
        const missing = opts.strategy.seeds
          .map((_, i) => i)
          .filter((i) => !crafts.some((c) => c.index === i && c.caption.trim()));
        if (missing.length) {
          return { ok: false, error: `Missing captions for seed indexes: ${missing.join(', ')}` };
        }
        const carouselGaps: string[] = [];
        for (let i = 0; i < opts.strategy.seeds.length; i++) {
          const seed = opts.strategy.seeds[i];
          if (seed.format !== 'carousel') continue;
          const c = crafts.find((x) => x.index === i);
          const n = Math.max(2, Number(seed.slide_count ?? 0) || 2);
          if (!c?.slide_prompts || c.slide_prompts.length < 2) {
            carouselGaps.push(`${i}: need ≥2 slide_prompts (want ~${n})`);
          }
        }
        if (carouselGaps.length) {
          return { ok: false, error: `Carousel seeds need slide_prompts. Fix: ${carouselGaps.join('; ')}` };
        }
        const redditGaps: string[] = [];
        for (let i = 0; i < opts.strategy.seeds.length; i++) {
          const seed = opts.strategy.seeds[i];
          if (!platformIsReddit(seed.platform)) continue;
          const c = crafts.find((x) => x.index === i);
          const check = assertRedditCraft({
            subreddit: c?.subreddit || seed.subreddit,
            title: c?.title || seed.title,
            caption: c?.caption
          });
          if (!check.ok) redditGaps.push(`${i}: ${check.errors.join(', ')}`);
        }
        if (redditGaps.length) {
          return {
            ok: false,
            error: `Reddit posts need valid craft. Fix: ${redditGaps.join('; ')}`
          };
        }
        const tagViolations: string[] = [];
        for (const c of crafts) {
          const seed = opts.strategy.seeds[c.index];
          if (!seed) continue;
          const check = assertHashtagPrefs(c.caption, seed.platform, opts.prefs);
          if (!check.ok) {
            tagViolations.push(`post ${c.index} (${seed.platform}): ${check.bad.join(' ')}`);
          }
        }
        if (tagViolations.length) {
          return {
            ok: false,
            error: `Hashtags outside brand-approved set: ${tagViolations.join('; ')}. Use ONLY approved tags or none.`
          };
        }
        submitted.current = {
          batchJustification: String(batch_justification ?? '').trim(),
          crafts
        };
        return { ok: true, posts: crafts.length, message: 'Batch stored. Call finish() next.' };
      }
    }),
    finish: tool({
      description: 'End this produce turn after submit_batch succeeded.',
      inputSchema: z.object({ summary: z.string() }),
      execute: async ({ summary }) => ({
        ok: !!submitted.current,
        summary,
        error: submitted.current ? undefined : 'Call submit_batch before finish'
      })
    })
  };

  const language = (opts.prefs.language || opts.profile?.language || '').trim();
  const personality = brandPersonality(opts.prefs, opts.profile);
  const policy = platformPolicyBlock(opts.prefs, opts.strategy);
  const winners = opts.winningPatterns?.trim()
    ? `\n${opts.winningPatterns.trim()}\nMine these patterns in every caption/angle. You may still call read_post_history for more detail.\n`
    : '';
  const visuals = opts.visualInsights?.trim()
    ? `\n${opts.visualInsights.trim()}\nPrefer genres/hooks that perform for this brand; a genre with +delta is a strong default; never force a genre the brief doesn't fit.\n`
    : `\n${VISUAL_WINNERS_NO_DATA}\n`;
  // Stessa lista di fallimenti del percorso legacy (executePlan + copy chief): il produce agent è
  // il writer di default, e writer e judge devono condividere la definizione di "sbagliato".
  // ownerEditPairsBlock: le riscritture vere dell'owner come esempi prima→dopo ('' senza edit).
  const baseSystem = `${PRODUCE_SYSTEM}
Brand: ${opts.profile?.name ?? ''}
Language: ${language || 'brand primary'}
Personality: ${personality || '(infer from studio)'}
Theme: ${opts.strategy.theme}
${policy}
${CAPTION_FAILURE_MODES}
${ownerEditPairsBlock(opts.prefs)}${winners}${visuals}Seeds (${opts.strategy.seeds.length}):
${seedBrief(opts.strategy)}`;

  const session = createHarnessSession({
    brandId: opts.brandId,
    userId: opts.userId,
    agent: 'produce',
    mode: opts.provider,
    model: opts.modelId,
    provider: opts.provider,
    surface: 'batch'
  });
  session.captureRequest({ system: baseSystem, messages: opts.messages });

  const steward = createSessionSteward(session, Object.keys(tools));
  const watchedTools = wrapTools(session, tools, steward.pipeline());

  let result;
  try {
    result = await generateText({
      model: opts.model,
      maxOutputTokens: maxOutputTokensFor(opts.provider),
      system: baseSystem,
      messages: opts.messages,
      allowSystemInMessages: true,
      tools: watchedTools,
      stopWhen: [hasToolCall('finish'), stepCountIs(PRODUCE_AGENT_MAX_STEPS)],
      // Su kie/Grok la temperatura non arriva comunque: `forceReasoning` (dentro KIE_GROK_NO_STORE)
      // la toglie dalla richiesta, ed è un bene misurato — il campionamento di default di kie/Grok
      // è PIÙ vario di 0.6, non meno (4 risposte distinte su 4 contro 2 a temperature 0). Metterla
      // a undefined qui evita solo il warning a ogni chiamata. Sul ripiego Gemini resta 0.6.
      temperature: opts.provider === 'kie' ? undefined : 0.6,
      providerOptions: opts.provider === 'kie' ? { openai: { ...KIE_GROK_NO_STORE } } : undefined,
      prepareStep: () => {
        const remaining = Math.max(0, Math.round((opts.deadlineMs - (Date.now() - t0)) / 1000));
        const step = {
          system: `${baseSystem}\n\n[budget] searches_used=${searches}/${SEARCH_BUDGET}; submitted=${!!submitted.current}; remaining_sec≈${remaining}`
        };
        const patched = applyStewardPrepareStep(session, steward, step, baseSystem) ?? {};
        session.capturePrepareStep(patched);
        return patched;
      },
      onStepFinish: (event) => {
        session.recordStep(event);
        const { toolCalls, toolResults, text } = event;
        steps.push({
          step: steps.length + 1,
          toolCalls: toolCalls?.map((c) => ({ name: c.toolName, input: c.input })),
          toolResults: toolResults?.map((r) => ({
            name: r.toolName,
            output: typeof r.output === 'string' ? r.output.slice(0, 500) : r.output
          })),
          text: text?.slice(0, 400)
        });
      }
    });
    session.recordAssistantText(result.text);
    session.recordUsage(result.totalUsage ?? result.usage);
    session.finish('finished');
  } catch (e) {
    session.finish('failed', e);
    throw e;
  } finally {
    persistHarnessSession(session);
    logAiCall({
      label: 'produce-agent',
      provider: opts.provider,
      model: opts.modelId,
      ms: Date.now() - t0,
      ok: true,
      brandId: opts.brandId,
      userId: opts.userId,
      context: 'produce-agent',
      ...extractSdkUsage(result?.totalUsage)
    });
  }

  const nextMessages: ModelMessage[] = [
    ...opts.messages,
    ...((result?.response?.messages as ModelMessage[] | undefined) ?? [])
  ];

  return {
    submitted: submitted.current,
    messages: nextMessages,
    steps,
    text: result?.text ?? ''
  };
}

type ReviewVerdict =
  | { approved: true; summary: string; steps: AgentStepLog[] }
  | { approved: false; summary: string; feedback: string; steps: AgentStepLog[] };

async function runProduceReviewer(opts: {
  model: LanguageModel;
  provider: 'kie' | 'llm';
  modelId: string;
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  profile: BrandProfile;
  posts: PreviewPost[];
  batchJustification: string;
  prefs: ContentPrefs;
}): Promise<ReviewVerdict> {
  const steps: AgentStepLog[] = [];
  let verdict: ReviewVerdict | null = null;
  const t0 = Date.now();
  let searches = 0;

  const postLines = opts.posts
    .map((p, i) => {
      const just = String(p.justification ?? '');
      const redditMeta = platformIsReddit(p.platform)
        ? `SUBREDDIT: r/${p.subreddit || '(MISSING)'} | TITLE: ${p.title || '(MISSING)'}`
        : '';
      const tags = [...String(p.caption ?? '').matchAll(/#[\p{L}0-9_]+/gu)].map((m) => m[0]);
      return `POST ${i} [${p.platform} · ${p.format} · media:${p.media}]
${redditMeta}
CAPTION: ${p.caption}
HASHTAGS_IN_CAPTION: ${tags.length ? tags.join(' ') : '(none)'}
IMAGE BRIEF: ${p.image_prompt?.slice(0, 280) || '(none)'}
${p.image_prompts?.length ? `SLIDE PROMPTS (${p.image_prompts.length}): ${p.image_prompts.map((s, j) => `[${j + 1}] ${s.slice(0, 80)}`).join(' | ')}` : ''}
JUSTIFICATION: ${just.slice(0, 400) || '(none)'}`;
    })
    .join('\n\n');

  const labeledImages = await collectBatchReviewImages(opts.posts);
  const imageParts = labeledImages;

  const tools = {
    search_web: tool({
      description: 'Verify a factual claim before approving/rejecting.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        searches += 1;
        if (searches > 3) return { error: 'search budget exhausted' };
        const g = await groundedText(query, 'Verify concisely with sources.', { brandId: opts.brandId });
        return { answer: g.text.slice(0, 800), sources: g.citations.slice(0, 3) };
      }
    }),
    approve: tool({
      description:
        'Approve only if the batch is strong enough to grow the brand organically (not merely correct).',
      inputSchema: z.object({
        summary: z.string().describe('Why this batch should earn organic reach/engagement.')
      }),
      execute: async ({ summary }) => {
        verdict = { approved: true, summary: summary.trim(), steps };
        return { ok: true };
      }
    }),
    request_changes: tool({
      description:
        'Reject when posts will not grow the brand (or fail quality/facts). Give actionable growth-oriented feedback.',
      inputSchema: z.object({
        summary: z.string(),
        feedback: z
          .string()
          .describe(
            'Concrete per-POST revision instructions focused on stronger hooks, specificity, visuals, and engagement.'
          )
      }),
      execute: async ({ summary, feedback }) => {
        verdict = {
          approved: false,
          summary: summary.trim(),
          feedback: feedback.trim(),
          steps
        };
        return { ok: true };
      }
    })
  };

  const personality = brandPersonality(opts.prefs, opts.profile);
  const hasReddit = opts.posts.some((p) => platformIsReddit(p.platform));
  const policy = [
    hashtagPrefsBlock(opts.prefs),
    hasReddit
      ? `REDDIT REVIEW: reject wrong/off-topic subs, missing title/subreddit, or self-promo/link spam that risks auto-mod bans.`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n');
  const intro = `Review this batch of ${opts.posts.length} posts for organic GROWTH of "${opts.profile?.name ?? ''}".
Language: ${(opts.prefs.language || opts.profile?.language || '').trim() || 'brand primary'}
Personality: ${personality || '(see brand)'}
${policy}
BATCH JUSTIFICATION: ${opts.batchJustification.slice(0, 1200)}
${opts.profile?.visual_style ? `VISUAL STYLE:\n${String(opts.profile.visual_style).slice(0, 900)}\n` : ''}
${postLines}

Rendered images (if any) follow this text. Labels (POST i / POST i slide j) are listed in attachment order — for carousels judge every slide.
Approve only if these assets would help the brand grow organically AND pass hashtag/Reddit hygiene; otherwise request_changes with concrete feedback.`;

  let result;
  let session: ReturnType<typeof createHarnessSession> | undefined;
  try {
    const imageContent: Array<
      { type: 'text'; text: string } | { type: 'image'; image: string }
    > = [{ type: 'text', text: intro }];
    for (const p of imageParts) {
      imageContent.push({ type: 'text', text: `[${p.label}]` });
      imageContent.push({
        type: 'image',
        image: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
      });
    }
    const messages = [{ role: 'user' as const, content: imageContent }];
    session = createHarnessSession({
      brandId: opts.brandId,
      userId: opts.userId,
      agent: 'produce_reviewer',
      mode: opts.provider,
      model: opts.modelId,
      provider: opts.provider,
      surface: 'batch'
    });
    session.captureRequest({ system: REVIEWER_SYSTEM, messages });

    const steward = createSessionSteward(session, Object.keys(tools));
    const watchedTools = wrapTools(session, tools, steward.pipeline());
    const reviewerSession = session;

    result = await generateText({
      model: opts.model,
      maxOutputTokens: maxOutputTokensFor(opts.provider),
      system: REVIEWER_SYSTEM,
      messages,
      allowSystemInMessages: true,
      tools: watchedTools,
      prepareStep: () => {
        const patched = applyStewardPrepareStep(reviewerSession, steward, {}, REVIEWER_SYSTEM) ?? {};
        reviewerSession.capturePrepareStep(patched);
        return patched;
      },
      stopWhen: [
        hasToolCall('approve'),
        hasToolCall('request_changes'),
        stepCountIs(PRODUCE_REVIEWER_MAX_STEPS)
      ],
      // Come sopra: su kie la temperatura la toglie `forceReasoning`, che qui serve perché il
      // reviewer gira fino a 12 step e senza si rivede il batch da capo a ogni step. Il 0.3 era
      // per un giudice ripetibile: su kie il giudizio ora campiona come il modello vuole. È il solo
      // punto di questa correzione dove si perde qualcosa (un filo di ripetibilità), ed è un
      // giudizio: il verdetto è ancorato alle immagini e alle regole, non alla temperatura.
      temperature: opts.provider === 'kie' ? undefined : 0.3,
      providerOptions: opts.provider === 'kie' ? { openai: { ...KIE_GROK_NO_STORE } } : undefined,
      onStepFinish: (event) => {
        reviewerSession.recordStep(event);
        const { toolCalls, toolResults, text } = event;
        steps.push({
          step: steps.length + 1,
          toolCalls: toolCalls?.map((c) => ({ name: c.toolName, input: c.input })),
          toolResults: toolResults?.map((r) => ({ name: r.toolName, output: r.output })),
          text: text?.slice(0, 400)
        });
      }
    });
    session.recordAssistantText(result.text);
    session.recordUsage(result.totalUsage ?? result.usage);
    session.finish('finished');
  } catch (e) {
    session?.finish('failed', e);
    throw e;
  } finally {
    if (session) persistHarnessSession(session);
    logAiCall({
      label: 'produce-reviewer',
      provider: opts.provider,
      model: opts.modelId,
      ms: Date.now() - t0,
      ok: true,
      brandId: opts.brandId,
      userId: opts.userId,
      context: 'produce-reviewer',
      ...extractSdkUsage(result?.totalUsage)
    });
  }

  if (verdict) return verdict;
  // No explicit verdict — fail-open approve so we don't block the batch forever.
  return {
    approved: true,
    summary: result?.text?.trim() || 'Reviewer ended without explicit verdict — shipping as-is.',
    steps
  };
}

/**
 * Full produce → render → review loop. Fail-open: on total agent failure returns null so
 * callers can fall back to legacy executePlan.
 */
export async function runProduceAgentLoop(opts: ProduceAgentOpts): Promise<ProduceAgentResult | null> {
  if (!produceAgentEnabled()) return null;
  return withBrandContext(opts.brandId, () => runProduceAgentLoopInner(opts));
}

async function loadProduceWinningPatterns(
  supabase: SupabaseClient,
  brandId: string,
  preloaded?: PastWinner[]
): Promise<string> {
  if (preloaded?.length) {
    return winningPatternsBlock(preloaded, { limit: 5 });
  }
  try {
    // OWN posts only (source='zernio') — scraped/competitor rows must never shape the patterns.
    const rows = await loadOwnPostHistory(supabase, brandId, { limit: 100 });
    if (!rows.length) {
      return `WINNING PATTERNS: no own published-post data yet (sync Zernio analytics to mine the brand's real winners). Use the default best practices and read_market / read_competitors for market patterns — do NOT invent brand-specific winners from competitor data.`;
    }
    const insights = analyzePostHistory(
      rows.map((h) => ({
        content: h.content,
        mediaType: h.media_type,
        publishedAt: h.published_at,
        metrics: h.metrics as AnyRec
      }))
    );
    const scored = (m: AnyRec | null | undefined) =>
      Number(m?.engagementRate ?? 0) || Number(m?.likes ?? 0) + Number(m?.comments ?? 0) * 2;
    const top: PastWinner[] = rows
      .slice()
      .sort((a, b) => scored(b.metrics as AnyRec) - scored(a.metrics as AnyRec))
      .slice(0, 8)
      .map((h) => ({
        content: h.content,
        platform: h.platform,
        metrics: h.metrics as AnyRec
      }));
    return winningPatternsBlock(top, { digest: historyInsightsDigest(insights), limit: 5 });
  } catch (e) {
    console.warn('[produce-agent] winning patterns preload failed:', e instanceof Error ? e.message : e);
    return '';
  }
}

async function runProduceAgentLoopInner(opts: ProduceAgentOpts): Promise<ProduceAgentResult | null> {
  const prefs = opts.prefs ?? {};
  const deadlineMs = opts.deadlineMs ?? 240_000;
  const t0 = Date.now();
  let { model, provider, modelId } = resolveModel();

  const [winningPatterns, visualInsights] = await Promise.all([
    loadProduceWinningPatterns(opts.supabase, opts.brandId, opts.topPosts),
    readVisualInsightsForAgent(opts.supabase, opts.brandId, { limit: 8 })
  ]);

  const initialUser = `Produce captions + image briefs that GROW "${opts.profile?.name ?? 'this brand'}" organically (${opts.strategy.seeds.length} seeds).
Theme: ${opts.strategy.theme}
Rationale: ${opts.strategy.rationale}
Do/Don't: ${opts.strategy.doDont}
${opts.strategyBrief ? `Strategy brief:\n${opts.strategyBrief.slice(0, 2500)}` : ''}
${winningPatterns ? `\n${winningPatterns}` : ''}

Think like a growth creative: use the WINNING PATTERNS above (and read_market / timely / web if needed), pick angles that earn attention and engagement, then submit_batch with growth justifications, then finish().`;

  let messages: ModelMessage[] = [{ role: 'user', content: initialUser }];
  let posts: PreviewPost[] = [];
  let batchJustification = '';
  let produceSteps: AgentStepLog[] = [];
  let reviewSteps: AgentStepLog[] = [];
  let reviewSummary = '';
  let approved = false;
  let rounds = 0;

  try {
    for (let round = 1; round <= PRODUCE_MAX_ROUNDS; round++) {
      rounds = round;
      opts.onProgress?.(
        'writing',
        round === 1
          ? 'Produce agent researching & writing captions…'
          : `Produce agent revising from reviewer feedback (round ${round}/${PRODUCE_MAX_ROUNDS})…`
      );

      const roundOpts = {
        model,
        provider,
        modelId,
        messages,
        supabase: opts.supabase,
        brandId: opts.brandId,
        userId: opts.userId,
        profile: opts.profile,
        strategy: opts.strategy,
        prefs,
        timezone: opts.timezone ?? 'Europe/Rome',
        deadlineMs: Math.max(30_000, deadlineMs - (Date.now() - t0)),
        winningPatterns,
        visualInsights
      } as const;

      let produce;
      try {
        produce = await runProduceRound(roundOpts);
      } catch (kieErr) {
        if (provider !== 'kie' || !llmConfigured()) throw kieErr;
        console.warn('[produce-agent] kie failed, retrying round on llm:', kieErr);
        ({ model, provider, modelId } = llmFallback());
        produce = await runProduceRound({ ...roundOpts, model, provider, modelId });
      }

      messages = produce.messages;
      produceSteps = [...produceSteps, ...produce.steps.map((s) => ({ ...s, step: produceSteps.length + s.step }))];

      if (!produce.submitted) {
        console.warn(`[produce-agent] round ${round}: no submit_batch — aborting to legacy`);
        return null;
      }

      batchJustification = produce.submitted.batchJustification;
      posts = applyProduceCraft(opts.strategy, produce.submitted.crafts, prefs);

      opts.onProgress?.('generating', `Rendering images for review (round ${round})…`);
      // Clear previous image urls before re-render on retries.
      for (const p of posts) {
        p.imageUrl = undefined;
        p.imageUrls = undefined;
      }
      await renderPreviewImages(opts.profile, posts, {
        supabase: opts.supabase,
        userId: opts.userId,
        brandId: opts.brandId,
        onProgress: opts.onProgress,
        onPost: () => {}
      });

      opts.onProgress?.('writing', `Reviewer checking captions + images (round ${round})…`);
      let review: ReviewVerdict;
      try {
        review = await runProduceReviewer({
          model,
          provider,
          modelId,
          supabase: opts.supabase,
          brandId: opts.brandId,
          userId: opts.userId,
          profile: opts.profile,
          posts,
          batchJustification,
          prefs
        });
      } catch (kieErr) {
        if (provider !== 'kie' || !llmConfigured()) throw kieErr;
        console.warn('[produce-reviewer] kie failed, retrying on llm:', kieErr);
        ({ model, provider, modelId } = llmFallback());
        review = await runProduceReviewer({
          model,
          provider,
          modelId,
          supabase: opts.supabase,
          brandId: opts.brandId,
          userId: opts.userId,
          profile: opts.profile,
          posts,
          batchJustification,
          prefs
        });
      }

      reviewSteps = [...reviewSteps, ...review.steps.map((s) => ({ ...s, step: reviewSteps.length + s.step }))];
      reviewSummary = review.summary;

      if (review.approved) {
        approved = true;
        break;
      }

      // Continue the SAME produce session with reviewer feedback.
      messages = [
        ...messages,
        {
          role: 'user',
          content: `REVIEWER REJECTED round ${round}/${PRODUCE_MAX_ROUNDS} — the batch is not strong enough for organic growth yet.
Summary: ${review.summary}
Feedback (authoritative — revise to raise stop-scroll / engagement / brand affinity; re-research if needed; then submit_batch again, then finish()):
${'feedback' in review ? review.feedback : ''}`
        }
      ];
    }

    persistAgentRun({
      brandId: opts.brandId,
      userId: opts.userId,
      agent: 'produce',
      mode: 'execute_review_loop',
      status: approved ? 'finished' : 'fallback',
      finishedOk: approved,
      notes: `rounds=${rounds}; ${batchJustification.slice(0, 500)}; review=${reviewSummary.slice(0, 400)}`,
      steps: [...produceSteps, ...reviewSteps]
    });

    // Attach batch justification on first post for downstream visibility.
    if (posts[0]) posts[0].batchJustification = batchJustification;

    return {
      posts,
      batchJustification,
      rounds,
      approved,
      produceSteps,
      reviewSteps,
      reviewSummary
    };
  } catch (e) {
    console.error('[produce-agent] loop failed:', e instanceof Error ? e.message : e);
    persistAgentRun({
      brandId: opts.brandId,
      userId: opts.userId,
      agent: 'produce',
      mode: 'execute_review_loop',
      status: 'failed',
      finishedOk: false,
      notes: e instanceof Error ? e.message.slice(0, 500) : 'error',
      steps: produceSteps
    });
    return null;
  }
}
