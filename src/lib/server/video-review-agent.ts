/**
 * Agentic video QC — same rubric as the one-shot judge, but the model can loop,
 * think, and pull live evidence (web, Meta Ad Library, brand winner reels, prior scores)
 * before it submits scores.
 *
 * Scores still go through finalizeVideoReview / verdictFromScores so a 3/10 hook
 * cannot be labelled ship. Research calibrates the bar; it does not replace watching the clip.
 */
import { swallow } from '$lib/server/swallow';
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { tool, stepCountIs, hasToolCall, type ModelMessage } from 'ai';
import { harnessGenerateText } from '$lib/server/harness';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { extractSdkUsage, logAiCall, getBrandContext } from '$lib/server/ai-log';
import { judgeThinkingLevel } from '$lib/server/gemini';
import { llmLanguageModel, llmVideoReviewerModel } from '$lib/server/llm';
import { createAdminClient } from '$lib/server/supabase-admin';
import { exaGroundedAnswer } from '$lib/server/exa';
import {
  searchMetaAdLibrary,
  formatMetaAdsDigestForPlanner,
  type MetaAdDigestItem
} from '$lib/server/meta-ad-library';
import { loadOwnPostHistory } from '$lib/server/own-post-history';
import { UGC_ORGANIC_MAX_DURATION, UGC_AD_DURATION } from '$lib/server/video';
import { CREATIVE_JUDGE_DOCTRINE } from '$lib/server/video-review-doctrine';
import {
  readBrandStudioForAgent,
  readKnowledgeForAgent,
  readMediaForAgent
} from '$lib/server/strategy-agent-reads';
import {
  finalizeVideoReview,
  videoReviewStandardRubric,
  type ReviewVideoOpts,
  type ReviewVideoResult,
  type VideoReview,
  type VideoReviewMedia,
  type VideoStandard
} from '$lib/server/video-review';
import {
  buildReviewCheckpoint,
  isAbortLikeError,
  type ReviewCheckpoint
} from '$lib/server/video-review-checkpoint';

const MODEL = llmVideoReviewerModel;

export const VIDEO_REVIEW_AGENT_MAX_STEPS = 8;
export const VIDEO_REVIEW_AGENT_MAX_WEB = 2;
export const VIDEO_REVIEW_AGENT_MAX_ADS = 2;
export const VIDEO_REVIEW_AGENT_TOOL_NAMES = [
  'read_brand_studio',
  'read_knowledge',
  'read_media',
  'search_web',
  'search_ad_library',
  'read_competitor_ads',
  'read_brand_winners',
  'read_prior_scores',
  'submit_review'
] as const;

/** Opt-out: VIDEO_REVIEW_AGENT_ENABLED=false uses the one-shot JSON judge. Default ON. */
export function videoReviewAgentEnabled(): boolean {
  return env.VIDEO_REVIEW_AGENT_ENABLED !== 'false';
}

export type VideoReviewAgentOpts = {
  url: string;
  opts: ReviewVideoOpts;
  media: VideoReviewMedia;
  brandId?: string | null;
  supabase?: SupabaseClient;
  abortSignal?: AbortSignal;
  checkpoint?: ReviewCheckpoint | null;
  onCheckpoint?: (cp: ReviewCheckpoint) => Promise<void> | void;
};

type WinnerReel = {
  platform: string;
  when: string | null;
  views: number;
  likes: number;
  comments: number;
  opener: string;
};

type PriorScoreRow = {
  overall: number | null;
  verdict: string | null;
  standard: string;
  weakest: string | null;
  summary: string;
  spoken?: string;
  onScreen?: string;
};

const scoreZ = z.number().int().min(1).max(10);

function clipNote(s: string, max = 240): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function metricNum(m: Record<string, unknown> | null | undefined, ...keys: string[]): number {
  if (!m) return 0;
  for (const k of keys) {
    const n = Number(m[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function winnerReelWeight(m: Record<string, unknown> | null | undefined): number {
  const views = metricNum(m, 'views', 'plays', 'impressions', 'video_views');
  const likes = metricNum(m, 'likes');
  const comments = metricNum(m, 'comments');
  const saves = metricNum(m, 'saves');
  const shares = metricNum(m, 'shares');
  return views + likes * 5 + comments * 12 + saves * 15 + shares * 8;
}

export function formatWinnerReelsDigest(rows: WinnerReel[]): string {
  if (!rows.length) return 'No own performing video posts in history (source=zernio). Calibrate from the rubric + web, not from invented brand winners.';
  const lines = rows.slice(0, 8).map((r, i) => {
    const stats = [`${r.views} views`, `${r.likes} likes`, `${r.comments} comments`].join(', ');
    return `#${i + 1} ${r.platform}${r.when ? ` · ${r.when}` : ''} · ${stats}\n  opener: "${r.opener}"`;
  });
  return [
    'BRAND WINNER REELS (own posts published via Anomalia — real performance, not scraped competitors):',
    'Use these to calibrate what THIS audience already rewards. Do not copy their hooks onto a weaker clip.',
    ...lines
  ].join('\n');
}

export function formatPriorScoresDigest(rows: PriorScoreRow[]): string {
  if (!rows.length) return 'No prior QC scores for this brand yet.';
  const nums = rows.map((r) => r.overall).filter((n): n is number => n != null && Number.isFinite(n));
  const avg = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
  const lines = rows.slice(0, 8).map((r, i) => {
    const bits = [
      `#${i + 1}`,
      r.standard,
      r.overall != null ? `${r.overall}/10` : 'n/a',
      r.verdict || '',
      r.weakest ? `weakest=${r.weakest}` : ''
    ].filter(Boolean);
    const scriptBits = [
      r.spoken ? `spoken: "${r.spoken.slice(0, 140)}"` : '',
      r.onScreen ? `on-screen: "${r.onScreen.slice(0, 140)}"` : ''
    ].filter(Boolean);
    return `- ${bits.join(' · ')}${scriptBits.length ? `\n  ${scriptBits.join('\n  ')}` : ''}${r.summary ? `\n  ${r.summary}` : ''}`;
  });
  return [
    `PRIOR QC ON THIS BRAND${avg != null ? ` (mean ${avg}/10)` : ''} — scripts + votes. Calibrate writing AND scores. Do not copy an old verdict onto a new clip.`,
    ...lines
  ].join('\n');
}

export function formatCompetitorAdsDigest(
  groups: Array<{ name: string; ads: Array<{ body?: string | null; cta?: string | null; pageName?: string | null }> }>
): string {
  const flat = groups.flatMap((g) =>
    (g.ads ?? []).slice(0, 4).map((a) => ({
      competitor: g.name,
      opener: String(a.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
      cta: String(a.cta ?? '').trim().slice(0, 80),
      page: String(a.pageName ?? '').trim()
    }))
  );
  if (!flat.length) return 'No stored competitor ads. Use search_ad_library for a live Meta pull.';
  const lines = flat.slice(0, 12).map((a, i) => {
    const who = a.page || a.competitor;
    return `#${i + 1} ${who}${a.cta ? ` · cta ${a.cta}` : ''}\n  opener: "${a.opener || '(no copy)'}"`;
  });
  return [
    'STORED COMPETITOR ADS (Studio harvest — steal STRUCTURE not copy):',
    ...lines
  ].join('\n');
}

export function buildVideoReviewAgentSystem(opts: {
  standard: VideoStandard;
  duration: number;
  brandName: string;
  language: string;
  category?: string | null;
  about?: string | null;
}): string {
  const cap = opts.standard === 'ads' ? UGC_AD_DURATION : UGC_ORGANIC_MAX_DURATION;
  const cat = opts.category?.trim() || '';
  const about = opts.about?.trim() ? clipNote(opts.about, 280) : '';
  return `You are a ruthless short-form creative director reviewing a FINISHED clip. You MAY think step-by-step and call tools. Generation craft cannot save a clip that fails scroll-stop. This is a DIAGNOSIS, not a vibe.

STANDARD: ${opts.standard === 'ads' ? 'PAID ADS' : 'ORGANIC UGC'}
CLIP LENGTH: ~${opts.duration.toFixed(1)}s (budget ${opts.standard === 'ads' ? `UGC ad ${cap}s` : `organic ≤${cap}s`})
BRAND: ${opts.brandName}${cat ? ` · category: ${cat}` : ''}
${about ? `ABOUT: ${about}` : ''}

WORKFLOW (mandatory):
1. Call read_brand_studio FIRST when brand context exists — what you actually sell, who it's for, Life-Force desire. Sleepclip: generic format lists without this context are worthless.
2. LOOK at the media in this message. Timestamp hook / reveal / CTA / dead seconds from WHAT YOU SEE AND HEAR. Transcribe spoken words. Read every on-screen line (carousel = every slide).
3. THINK: who would stop, why, is the SCRIPT the failure (Beech) or the picture (scroll-stop / skin).
4. RESEARCH (1–3 tools, then stop):
   - read_prior_scores — previous scripts + votes for this brand (calibrate writing, not copy a verdict).
   - search_web / search_ad_library / read_competitor_ads as needed for THIS category.
   - read_knowledge / read_media if a claim or screenshot must be true to the brand.
5. submit_review. You MUST fill script_spoken (verbatim heard, empty if silent) and script_on_screen (every readable line). judgment = the comment stored with the vote.

Caps: at most ${VIDEO_REVIEW_AGENT_MAX_WEB} search_web and ${VIDEO_REVIEW_AGENT_MAX_ADS} search_ad_library calls. Then submit_review.

${CREATIVE_JUDGE_DOCTRINE}

${videoReviewStandardRubric(opts.standard)}

SCORING: 1 = absent/broken, 5 = average, 8 = would ship, 10 = exceptional. Be harsh — most clips are 4–6.
LANGUAGE: write summary, issues, next_test, doomscroll_reason, hook_line/visual in ${opts.language} (natural, not translated marketing-speak). Keep dimension ids and enums in English.
next_test MUST be one variable: "Because [weakest_link], change [exactly one thing]; judge on [hook rate / hold / CTR]."
Do not finish without submit_review.`;
}

function buildUserText(opts: ReviewVideoOpts, duration: number, hasVideo: boolean): string {
  const caption = opts.caption?.trim()
    ? `CAPTION / PRIMARY TEXT:\n${opts.caption.trim().slice(0, 800)}`
    : 'CAPTION: (none)';
  const script = opts.script?.trim()
    ? `INTENDED SPOKEN SCRIPT (compare to what you actually hear — save the HEARD line in script_spoken):\n${opts.script.trim().slice(0, 1200)}`
    : 'INTENDED SPOKEN: (unknown — transcribe into script_spoken; empty if silent)';
  const onScreen = opts.intendedOnScreen?.trim()
    ? `INTENDED ON-SCREEN COPY (compare to what you can READ — save the READ lines in script_on_screen):\n${opts.intendedOnScreen.trim().slice(0, 1200)}`
    : 'INTENDED ON-SCREEN: (unknown — transcribe every readable line into script_on_screen)';
  const still = opts.kind && opts.kind !== 'video';
  const watch = hasVideo
    ? 'MEDIA: HOOK stills (first 3s, sound-off / 500ms) plus the actual video. Watch in order for pacing, dead seconds, reveal, CTA.'
    : still
      ? `MEDIA: stills (${opts.kind}). Mute test = the COVER as a feed thumbnail. Read every on-screen line. spoken_craft scores the COPY craft (overlays / carousel text), not a voiceover.`
      : 'MEDIA: stills (hook window, mid, 60% mark, ending) plus spoken audio. Infer motion from still-to-still change. Be harsher on scroll_stop if the first still is a static talking head.';
  return `Review this finished ${still ? opts.kind : 'clip'}.

PRODUCT / OFFER: ${opts.product?.trim() || '(unspecified)'}
KIND: ${opts.kind ?? (hasVideo ? 'video' : 'image')}
${caption}
${script}
${onScreen}

WATCH PROTOCOL:
${
  still
    ? `1. Freeze on the COVER. Would this thumbnail stop you at feed speed?
2. Read every on-screen line (carousel = every slide). Mute test = the still itself.
3. Name the reveal (the sentence a stranger would repeat). If it is not in the first frame / first slide, structure is weak.
4. Count CTAs in the copy. spoken_craft = writing on the still, not a voiceover.`
    : `1. Freeze on the first still. Would this thumbnail stop you at feed speed?
2. First 2 seconds MUTED.
3. First 3 seconds with sound — callout, loop, promise match, uniqueness.
4. Timestamp the REVEAL (sentence you'd repeat to a friend). Must be before 60% (${(duration * 0.6).toFixed(1)}s).
5. Hunt dead seconds. Count CTAs.`
}

${watch}

Then research if needed, then submit_review.`;
}

type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: Buffer }
  | { type: 'file'; data: Buffer; mediaType: string };

function mediaUserContent(opts: ReviewVideoOpts, media: VideoReviewMedia): UserContentPart[] {
  const parts: UserContentPart[] = [{ type: 'text', text: buildUserText(opts, media.duration, !!media.videoMp4) }];
  for (const f of media.frames) {
    parts.push({ type: 'text', text: f.label });
    parts.push({ type: 'image', image: Buffer.from(f.data, 'base64') });
  }
  if (media.videoMp4) {
    parts.push({ type: 'text', text: 'FULL CLIP (watch in order):' });
    parts.push({ type: 'file', data: media.videoMp4, mediaType: 'video/mp4' });
  } else if (media.audioMp3) {
    parts.push({ type: 'text', text: 'SPOKEN AUDIO of the take:' });
    parts.push({ type: 'file', data: media.audioMp3, mediaType: 'audio/mpeg' });
  }
  return parts;
}

async function loadBrandBackdrop(
  supabase: SupabaseClient,
  brandId: string
): Promise<{ category: string | null; about: string | null }> {
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('category, about')
    .eq('brand_id', brandId)
    .maybeSingle();
  return {
    category: kit?.category ? String(kit.category).trim() : null,
    about: kit?.about ? String(kit.about).trim() : null
  };
}

export async function reviewVideoWithAgent(input: VideoReviewAgentOpts): Promise<ReviewVideoResult> {
  const brandId = input.brandId ?? getBrandContext();
  const supabase = input.supabase ?? (brandId ? createAdminClient() : null);
  const opts = input.opts;
  const media = input.media;
  const brandName = opts.brandName?.trim() || 'Brand';
  const language = opts.language?.trim() || 'Italian';

  let category: string | null = null;
  let about: string | null = null;
  if (supabase && brandId) {
    try {
      const kit = await loadBrandBackdrop(supabase, brandId);
      category = kit.category;
      about = kit.about;
    } catch {
      /* kit is optional */
    }
  }

  const notes: string[] = [...(input.checkpoint?.notes ?? [])];
  const toolsUsed: string[] = [...(input.checkpoint?.toolsUsed ?? [])];
  let webLeft = input.checkpoint?.webLeft ?? VIDEO_REVIEW_AGENT_MAX_WEB;
  let adsLeft = input.checkpoint?.adsLeft ?? VIDEO_REVIEW_AGENT_MAX_ADS;
  let steps = input.checkpoint?.steps ?? 0;
  const state: { review: VideoReview | null } = { review: null };
  let lastCheckpoint: ReviewCheckpoint | null = input.checkpoint ?? null;

  const tools = {
    read_brand_studio: tool({
      description:
        'Studio: what the brand sells, audience, voice, products, competitors. Call FIRST so the score is about THIS brand, not generic UGC.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!supabase || !brandId) return { error: 'no_brand_context' };
        notes.push('Brand studio');
        return readBrandStudioForAgent(supabase, brandId);
      }
    }),
    read_knowledge: tool({
      description: 'Brand notes/docs (claims, features). Use before scoring a specific product claim.',
      inputSchema: z.object({
        query: z.string().optional(),
        kind: z.enum(['note', 'document', 'image']).optional()
      }),
      execute: async (input) => {
        if (!supabase || !brandId) return { error: 'no_brand_context' };
        notes.push(`Knowledge · ${input.query ?? 'list'}`);
        return readKnowledgeForAgent(supabase, brandId, { ...input, limit: 20 });
      }
    }),
    read_media: tool({
      description: 'Brand Media library (screenshots/product stills) — check the demo on screen is a real asset.',
      inputSchema: z.object({
        query: z.string().optional(),
        kind: z.enum(['image', 'video']).optional()
      }),
      execute: async (input) => {
        if (!supabase || !brandId) return { error: 'no_brand_context' };
        notes.push(`Media library · ${input.query ?? 'list'}`);
        return readMediaForAgent(supabase, brandId, { ...input, limit: 20 });
      }
    }),
    search_web: tool({
      description:
        'Search the live web (Exa) for current short-form / Meta creative standards, hook tests, or this category’s winning video patterns. Not for “is my clip good”.',
      inputSchema: z.object({
        query: z
          .string()
          .min(8)
          .max(240)
          .describe('e.g. "Meta Reels 2026 3 second video play UGC hook" or "{category} winning TikTok ad structure"')
      }),
      execute: async ({ query }) => {
        if (webLeft <= 0) return { error: `search_web cap reached (${VIDEO_REVIEW_AGENT_MAX_WEB})` };
        webLeft -= 1;
        const q = query.trim();
        const { text, citations } = await exaGroundedAnswer(q);
        const urls = citations.slice(0, 5).map((c) => c.uri).filter(Boolean);
        notes.push(clipNote(`Web · ${q}: ${text || '(no answer)'}`));
        return {
          query: q,
          remaining: webLeft,
          answer: clipNote(text || 'No web answer — score from the rubric and the clip.', 1400),
          sources: urls
        };
      }
    }),
    search_ad_library: tool({
      description:
        'Live Meta Ad Library search (ScrapeCreators). Use a CATEGORY / pain keyword, not this brand’s name. Prefer VIDEO + ACTIVE.',
      inputSchema: z.object({
        query: z.string().min(3).max(120).describe('Keyword, e.g. "CRM onboarding" or "acne serum UGC"'),
        country: z.string().max(8).optional()
      }),
      execute: async ({ query, country }) => {
        if (adsLeft <= 0) return { error: `search_ad_library cap reached (${VIDEO_REVIEW_AGENT_MAX_ADS})` };
        adsLeft -= 1;
        const q = query.trim();
        let ads: MetaAdDigestItem[] = [];
        try {
          ads = await searchMetaAdLibrary(q, {
            country: country?.trim() || 'ALL',
            status: 'ACTIVE',
            mediaType: 'VIDEO',
            sortBy: 'total_impressions',
            limit: 8
          });
        } catch (e) {
          return { error: e instanceof Error ? e.message : 'ad_library_failed', remaining: adsLeft };
        }
        notes.push(`Ad Library · "${q}": ${ads.length} active video ads`);
        return {
          query: q,
          remaining: adsLeft,
          count: ads.length,
          digest: formatMetaAdsDigestForPlanner(ads, 8) || 'No video ads for that query.'
        };
      }
    }),
    read_competitor_ads: tool({
      description: 'Stored competitor ads already harvested for this brand (Studio). Free. Steal structure, not copy.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!supabase || !brandId) return { error: 'no_brand_context' };
        const { data } = await supabase
          .from('competitors')
          .select('name, top_ads')
          .eq('brand_id', brandId)
          .limit(12);
        const groups = (data ?? []).map((row) => ({
          name: String(row.name ?? 'competitor'),
          ads: Array.isArray(row.top_ads) ? (row.top_ads as Array<{ body?: string | null; cta?: string | null; pageName?: string | null }>) : []
        }));
        const digest = formatCompetitorAdsDigest(groups);
        notes.push(`Competitor ads · ${groups.reduce((n, g) => n + g.ads.length, 0)} stored creatives`);
        return { digest };
      }
    }),
    read_brand_winners: tool({
      description: 'This brand’s own published video posts ranked by views/engagement (Anomalia history, not scraped competitors).',
      inputSchema: z.object({}),
      execute: async () => {
        if (!supabase || !brandId) return { error: 'no_brand_context' };
        const hist = await loadOwnPostHistory(supabase, brandId, { limit: 80, sinceDays: 180 });
        const videos = hist
          .filter((r) => /reel|video|short|clip/i.test(String(r.media_type ?? '')))
          .map((r) => {
            const m = (r.metrics ?? {}) as Record<string, unknown>;
            return {
              platform: String(r.platform ?? '?'),
              when: r.published_at ? String(r.published_at).slice(0, 10) : null,
              views: metricNum(m, 'views', 'plays', 'impressions', 'video_views'),
              likes: metricNum(m, 'likes'),
              comments: metricNum(m, 'comments'),
              opener: String(r.content ?? '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 160),
              w: winnerReelWeight(m)
            };
          })
          .sort((a, b) => b.w - a.w)
          .slice(0, 8);
        const digest = formatWinnerReelsDigest(videos);
        notes.push(`Brand winners · ${videos.length} own reels`);
        return { digest, count: videos.length };
      }
    }),
    read_prior_scores: tool({
      description: 'Recent QC scores this judge already gave this brand — calibrate harshness, do not copy a verdict.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!supabase || !brandId) return { error: 'no_brand_context' };
        let { data, error } = await supabase
          .from('video_reviews')
          .select('overall, verdict, standard, review, media_url, script_spoken, script_on_screen, judgment, caption')
          .eq('brand_id', brandId)
          .eq('status', 'ready')
          .order('updated_at', { ascending: false })
          .limit(10);
        if (error) {
          ({ data } = await supabase
            .from('video_reviews')
            .select('overall, verdict, standard, review, media_url')
            .eq('brand_id', brandId)
            .eq('status', 'ready')
            .order('updated_at', { ascending: false })
            .limit(10));
        }
        const rows: PriorScoreRow[] = (data ?? [])
          .filter((r) => String(r.media_url ?? '') !== input.url)
          .slice(0, 8)
          .map((r) => {
            const rev =
              r.review && typeof r.review === 'object' ? (r.review as Record<string, unknown>) : {};
            const script =
              rev.script && typeof rev.script === 'object' ? (rev.script as Record<string, unknown>) : {};
            return {
              overall: r.overall == null ? null : Number(r.overall),
              verdict: r.verdict ? String(r.verdict) : null,
              standard: String(r.standard ?? 'organic'),
              weakest: rev.weakest_link ? String(rev.weakest_link) : null,
              summary: clipNote(String(r.judgment ?? rev.summary ?? ''), 160),
              spoken: String(r.script_spoken ?? script.spoken ?? '').trim(),
              onScreen: String(r.script_on_screen ?? script.on_screen ?? '').trim()
            };
          });
        const digest = formatPriorScoresDigest(rows);
        notes.push(`Prior QC · ${rows.length} scored clips`);
        return { digest, count: rows.length };
      }
    }),
    submit_review: tool({
      description: 'Submit the final diagnosis for THIS clip. Ends the loop. Scores must come from watching the media.',
      inputSchema: z.object({
        doomscroll_stops: z.boolean(),
        doomscroll_who: z.string().optional(),
        doomscroll_reason: z.string(),
        hook_at_s: z.number().optional(),
        hook_type: z.string().optional(),
        hook_line: z.string().optional(),
        hook_visual: z.string().optional(),
        hook_callout: z.boolean().optional(),
        hook_open_loop: z.boolean().optional(),
        hook_promise_match: z.boolean().optional(),
        hook_unique: z.boolean().optional(),
        reveal_at_s: z.number().optional(),
        cta_at_s: z.number().optional(),
        dead_seconds: z.array(z.number()).optional(),
        scores: z.object({
          scroll_stop: scoreZ,
          sound_off: scoreZ,
          hold: scoreZ,
          authenticity: scoreZ,
          // Conteggio arti/mani/prospettiva — vedi ANATOMY nel rubric condiviso. Obbligatorio:
          // non giudicarlo lascerebbe la coverage sotto il full e nessuna clip potrebbe mai "ship".
          anatomy: scoreZ,
          structure: scoreZ,
          spoken_craft: scoreZ,
          cta_soft: scoreZ.optional(),
          loop_worthiness: scoreZ.optional(),
          audience_signal: scoreZ.optional(),
          proof: scoreZ.optional(),
          offer: scoreZ.optional(),
          uniqueness: scoreZ.optional(),
          claims_safe: scoreZ.optional()
        }),
        issues: z
          .array(
            z.object({
              dimension: z.string(),
              severity: z.enum(['critical', 'major', 'nit']),
              at_s: z.number().nullable().optional(),
              problem: z.string(),
              fix: z.string()
            })
          )
          .max(8),
        weakest_link: z.string(),
        next_test: z.string(),
        summary: z.string(),
        judgment: z.string().optional(),
        script_spoken: z
          .string()
          .describe('Verbatim spoken words you HEARD. Empty string if silent / still.'),
        script_on_screen: z
          .string()
          .describe('Every readable on-screen line (headlines, overlays, carousel slides), newline-separated.')
      }),
      execute: async (raw) => {
        const review = finalizeVideoReview(raw as unknown as Record<string, unknown>, {
          standard: opts.standard,
          duration_s: media.duration
        });
        state.review = review;
        return {
          ok: true,
          overall: review.overall,
          verdict: review.verdict
        };
      }
    })
  };

  const system = buildVideoReviewAgentSystem({
    standard: opts.standard,
    duration: media.duration,
    brandName,
    language,
    category,
    about
  });

  const t0 = Date.now();
  let loopOk = false;
  let loopError: string | undefined;
  let aborted = false;
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    thinkingTokens: 0
  };

  const persistCp = (messages: unknown[]) => {
    const cp = buildReviewCheckpoint({
      steps,
      webLeft,
      adsLeft,
      notes,
      toolsUsed,
      messages
    });
    if (!cp) return;
    lastCheckpoint = cp;
    void Promise.resolve(input.onCheckpoint?.(cp)).catch(swallow('Promise.resolve failed'));
  };

  const remainingSteps = Math.max(1, VIDEO_REVIEW_AGENT_MAX_STEPS - steps);
  const resumeHint = lastCheckpoint
    ? `\n\nRESUME: you already completed ${lastCheckpoint.steps} step(s) and called: ${
        lastCheckpoint.toolsUsed.join(', ') || 'none'
      }. Do not repeat those tools. Continue from the next workflow step and call submit_review as soon as you can score THIS clip.`
    : '';
  const userContent = mediaUserContent(opts, media);
  if (resumeHint && userContent[0] && userContent[0].type === 'text') {
    userContent[0] = { type: 'text', text: `${userContent[0].text}${resumeHint}` };
  }
  const messages: ModelMessage[] = [
    { role: 'user', content: userContent },
    ...((lastCheckpoint?.rest ?? []) as ModelMessage[])
  ];

  try {
    const result = await harnessGenerateText({
      brandId,
      agent: 'video_review',
      mode: opts.standard ?? 'organic',
      model: MODEL(),
      provider: 'llm',
      surface: 'batch'
    }, {
      model: llmLanguageModel(MODEL()),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      system,
      messages,
      tools,
      abortSignal: input.abortSignal,
      stopWhen: [hasToolCall('submit_review'), stepCountIs(remainingSteps)],
      temperature: 0.2,
      providerOptions: {
        // AI SDK takes the level lowercase; the @google/genai judges use genaiThinking().
        google: { thinkingConfig: { thinkingLevel: judgeThinkingLevel() } }
      },
      prepareStep: () => {
        if (input.abortSignal?.aborted) return {};
        if (state.review) return {};
        if (steps >= 5) {
          return { toolChoice: { type: 'tool' as const, toolName: 'submit_review' } };
        }
        return {};
      },
      onStepFinish: ({ usage: u, toolResults, response }) => {
        steps += 1;
        const step = extractSdkUsage(u);
        usage = {
          inputTokens: usage.inputTokens + (step.inputTokens ?? 0),
          outputTokens: usage.outputTokens + (step.outputTokens ?? 0),
          cachedTokens: usage.cachedTokens + (step.cachedTokens ?? 0),
          thinkingTokens: usage.thinkingTokens + (step.thinkingTokens ?? 0)
        };
        for (const tr of toolResults ?? []) {
          toolsUsed.push(tr.toolName);
        }
        const msgs = (response as { messages?: unknown[] } | undefined)?.messages;
        if (Array.isArray(msgs) && msgs.length) persistCp(msgs);
      }
    });
    const total = extractSdkUsage(result.totalUsage);
    usage = {
      inputTokens: total.inputTokens ?? usage.inputTokens,
      outputTokens: total.outputTokens ?? usage.outputTokens,
      cachedTokens: total.cachedTokens ?? usage.cachedTokens,
      thinkingTokens: total.thinkingTokens ?? usage.thinkingTokens
    };
    const finalMsgs = (result.response as { messages?: unknown[] } | undefined)?.messages;
    if (Array.isArray(finalMsgs) && finalMsgs.length) persistCp(finalMsgs);
    loopOk = !!state.review;
  } catch (e) {
    if (isAbortLikeError(e)) {
      aborted = true;
      loopError = 'aborted';
    } else {
      loopError = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.name === 'CreditsExhaustedError') throw e;
      console.warn('[video-review-agent]', loopError);
    }
  } finally {
    logAiCall({
      label: 'video.review.agent',
      provider: 'llm',
      model: MODEL(),
      ms: Date.now() - t0,
      ok: loopOk,
      error: loopError,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      thinkingTokens: usage.thinkingTokens,
      brandId: brandId ?? undefined,
      context: `video-review-agent:${opts.standard}:tools${toolsUsed.join(',') || 'none'}`
    });
  }

  if (!state.review) {
    if (aborted) return { ok: false, error: 'aborted', aborted: true, checkpoint: lastCheckpoint };
    return { ok: false, error: 'agent_no_submit', checkpoint: lastCheckpoint };
  }
  state.review.research = {
    tools: [...new Set(toolsUsed.filter((t) => t !== 'submit_review'))],
    notes: notes.slice(0, 8)
  };
  return { ok: true, review: state.review };
}
