import { swallow } from '$lib/server/swallow';
import { maxOutputTokensFor } from '$lib/server/ai-output-limits';
import { tool, stepCountIs, hasToolCall, type StopCondition } from 'ai';
import { harnessGenerateText } from '$lib/server/harness';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { logAiCall, withBrandContext } from '$lib/server/ai-log';
import { persistAgentRun } from '$lib/server/agent-runs';
import {
  agentModel,
  withAgentFallback,
  appendBudgetToSystem,
  createStrategyBudget,
  addStrategyStepCost,
  stallDetected,
  stepFingerprint,
  deadlineReached,
  fetchUsdBudget,
  type StrategyBudget
} from '$lib/server/strategy-agent';
import { genaiClient } from '$lib/server/brand-context';
import { buildClockSection, resolveScheduleInput } from '$lib/server/clock';
import { writeMemory } from '$lib/server/brand-memory';
import { analyzePostHistory, historyInsightsDigest, type HistoryPost } from '$lib/server/post-history-insights';
import { OWN_SOURCE } from '$lib/server/own-post-history';
import { buildSeoMetrics } from '$lib/server/seo-metrics';
import {
  loadActiveGtm,
  currentPhaseIndex,
  reviewPhase,
  phasePerformanceDigest
} from '$lib/server/gtm';
import {
  loadActivePlan,
  revisePlan,
  cadenceAllowed
} from '$lib/server/editorial-plan';
import { plannerProfile, planEvidence } from '$lib/server/planner-inputs';
import { activeGtmBrief } from '$lib/server/gtm';
import { localeLanguageName } from '$lib/i18n/locale';
import { EDITOR_POST_COLS, requireZernioCancellation } from '$lib/server/post-editing';
import { publishApprovedPost, type ApprovablePost } from '$lib/server/publish';
import { assessEvidence, evidenceBlock, rankingIsSafe, sampleVerdict } from '$lib/server/evidence-quality';
import { diagnoseCreativeFunnel, funnelBrief } from '$lib/server/creative-funnel';

// ── Analytics review agent ────────────────────────────────────────────────────
// Periodic (and on-demand) multi-step loop: read performance → adapt GTM / editorial
// plan (as proposals) → rewrite pending/scheduled socials + draft blog → remember lessons.
// Complements weekly-recap (email) and the SEO review agent (search/backlinks).

export const MAX_ANALYTICS_REVIEW_STEPS = 32;
const STALL_STEP_THRESHOLD = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type AnalyticsReviewOpts = {
  supabase: SupabaseClient;
  brand: AnyRec;
  /** Optional owner guidance ("focus on LinkedIn", "kill carousels"). */
  guidance?: string;
  /** Cron = weekly; chat = on_demand. Stored on agent_runs.mode. */
  mode?: 'weekly' | 'on_demand';
  deadlineMs?: number;
  verbose?: boolean;
  userId?: string;
};

export type AnalyticsReviewResult = {
  notes: string;
  actions: string[];
  costUsd: number;
};

/** Opt-out: ANALYTICS_REVIEW_AGENT_ENABLED=false skips the loop (cron + chat). */
export function analyticsReviewAgentEnabled(): boolean {
  return env.ANALYTICS_REVIEW_AGENT_ENABLED !== 'false';
}

function mNum(m: AnyRec | null | undefined, key: string): number {
  return Number(m?.[key]) || 0;
}

/** Rich week-over-week + pattern digest for the agent (and reusable by callers). */
export async function buildAnalyticsDigest(
  supabase: SupabaseClient,
  brandId: string
): Promise<string> {
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const twoWeeksAgo = new Date(now - 14 * 86400000).toISOString();

  const [
    { data: hist },
    { data: posts },
    { data: articles },
    { data: geoRows },
    { count: pendingCount },
    { count: scheduledCount }
  ] = await Promise.all([
    supabase
      .from('social_post_history')
      .select('platform, content, media_type, published_at, metrics, thumbnail_url')
      .eq('brand_id', brandId)
      .eq('source', OWN_SOURCE) // OWN posts only — scraped rows are pre-app/competitor data, not brand performance
      .gte('published_at', twoWeeksAgo)
      .order('published_at', { ascending: false })
      .limit(200),
    supabase
      .from('posts')
      .select('id, platform, status, caption, format, scheduled_for, published_at, media_url')
      .eq('brand_id', brandId)
      .in('status', ['pending_user', 'scheduled', 'published'])
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('brand_articles')
      .select('id, title, status, published_at, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('brand_geo_audits')
      .select('search, backlinks, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'pending_user'),
    supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'scheduled')
  ]);

  const rows = hist ?? [];
  const thisWeek = rows.filter((r) => r.published_at && r.published_at >= weekAgo);
  const prevWeek = rows.filter((r) => r.published_at && r.published_at < weekAgo);

  // article_views is its own per-day counter table (bumped by the anonymous blog beacon), not a
  // column on brand_articles — sum it here instead of selecting a column that doesn't exist.
  const articleIds = (articles ?? []).map((a) => a.id as string);
  const viewsByArticle = new Map<string, number>();
  if (articleIds.length) {
    const { data: viewRows } = await supabase
      .from('article_views')
      .select('article_id, count')
      .in('article_id', articleIds);
    for (const v of viewRows ?? []) {
      viewsByArticle.set(
        v.article_id as string,
        (viewsByArticle.get(v.article_id as string) ?? 0) + (Number(v.count) || 0)
      );
    }
  }

  const sum = (list: typeof rows) => {
    let likes = 0,
      comments = 0,
      shares = 0,
      views = 0,
      impressions = 0,
      saves = 0;
    for (const r of list) {
      likes += mNum(r.metrics, 'likes');
      comments += mNum(r.metrics, 'comments');
      shares += mNum(r.metrics, 'shares');
      views += mNum(r.metrics, 'views');
      impressions += mNum(r.metrics, 'impressions');
      saves += mNum(r.metrics, 'saves');
    }
    return { likes, comments, shares, views, impressions, saves, posts: list.length };
  };

  const cur = sum(thisWeek);
  const prev = sum(prevWeek);
  const score = (e: typeof cur) => e.likes + e.comments * 2 + e.shares * 3 + e.views * 0.01;
  const delta =
    prev.posts > 0 ? Math.round(((score(cur) - score(prev)) / Math.max(1, score(prev))) * 100) : null;

  const byPlatform = new Map<string, { posts: number; likes: number; comments: number; views: number }>();
  for (const r of thisWeek) {
    const p = String(r.platform ?? '?').toLowerCase();
    const e = byPlatform.get(p) ?? { posts: 0, likes: 0, comments: 0, views: 0 };
    e.posts += 1;
    e.likes += mNum(r.metrics, 'likes');
    e.comments += mNum(r.metrics, 'comments');
    e.views += mNum(r.metrics, 'views');
    byPlatform.set(p, e);
  }

  const ranked = [...thisWeek]
    .map((r) => ({
      platform: r.platform,
      caption: String(r.content ?? '').slice(0, 120),
      score:
        mNum(r.metrics, 'likes') +
        mNum(r.metrics, 'comments') * 2 +
        mNum(r.metrics, 'shares') * 3 +
        mNum(r.metrics, 'views') * 0.01,
      metrics: r.metrics
    }))
    .sort((a, b) => b.score - a.score);

  const winners = ranked.slice(0, 5);
  const losers = ranked.filter((r) => r.score > 0).slice(-3).reverse();

  const historyPosts: HistoryPost[] = rows.map((r) => ({
    content: r.content,
    mediaType: r.media_type,
    publishedAt: r.published_at,
    metrics: (r.metrics ?? {}) as HistoryPost['metrics']
  }));
  const insights = historyInsightsDigest(analyzePostHistory(historyPosts));

  const blogPublished = (articles ?? []).filter((a) => a.status === 'published');
  const blogDrafts = (articles ?? []).filter((a) => a.status === 'draft' || a.status === 'approved');
  const blogViews = blogPublished.reduce((n, a) => n + (viewsByArticle.get(a.id as string) ?? 0), 0);

  const seo = buildSeoMetrics(geoRows ?? []);

  const pending = (posts ?? []).filter((p) => p.status === 'pending_user').slice(0, 12);
  const scheduled = (posts ?? []).filter((p) => p.status === 'scheduled').slice(0, 12);

  // EVIDENCE DISCIPLINE. This digest is not read by a human who will squint at it — it is read by an
  // agent that rewrites next week's brief from it. Five posts ranked 1-5 is a sort of random noise
  // presented as a leaderboard, and acting on it every week moves the strategy in a different
  // direction each time. So the ranking is gated on the sample that produced it.
  const rankable = rankingIsSafe(cur.posts, Math.min(5, ranked.length));
  const evidence = assessEvidence({
    // A week-over-week comparison of whatever happened to be published is a trend, not a test:
    // nothing was randomised and more than one thing changed.
    design: 'trend',
    sample: cur.posts,
    unit: 'post pubblicati e tracciati',
    window: 'ultimi 7 giorni vs 7 precedenti',
    rankedItems: Math.min(5, ranked.length),
    // We compare the posts that exist; the ones a human rejected before publishing are invisible.
    survivorsOnly: true,
    // Reach numbers are the platform's distribution decision, not the content's value.
    vanityMetric: cur.impressions > 0 || cur.views > 0,
    // Weekly plan and caption edits are cheap to revert; the agent proposes GTM changes instead of
    // applying them, which is what keeps this `true`.
    reversible: true
  });

  // Which LAYER is failing, not just that something is. We can read the top of the funnel only:
  // a platform "view" on Reels/TikTok is counted at ~3 seconds, so views/impressions is a usable
  // thumbstop proxy — but nothing we sync carries a 15-second count, so hold stays unreadable and
  // says so instead of being silently scored as a failure.
  const funnel = diagnoseCreativeFunnel({
    thumbstop: cur.impressions > 0 && cur.views > 0 ? cur.views / cur.impressions : null,
    hold: null,
    ctr: null,
    cvr: null
  });

  const lines = [
    `WINDOW: last 7 days vs previous 7 days.`,
    ...(rows.length === 0
      ? ['NOTE: no OWN published-post engagement data in the window (Zernio analytics not synced). Do NOT infer performance, top posts or patterns from this — keep proposals qualitative or skip until data exists.']
      : []),
    `SOCIAL this week: ${cur.posts} tracked posts — likes ${cur.likes}, comments ${cur.comments}, shares ${cur.shares}, views ${cur.views}, impressions ${cur.impressions}, saves ${cur.saves}.`,
    `SOCIAL prev week: ${prev.posts} posts — likes ${prev.likes}, comments ${prev.comments}, shares ${prev.shares}, views ${prev.views}.`,
    delta == null ? 'Engagement delta: n/a (no prior week).' : `Engagement delta: ${delta > 0 ? '+' : ''}${delta}%.`,
    `Queue: ${pendingCount ?? 0} pending approval, ${scheduledCount ?? 0} scheduled.`,
    [...byPlatform.entries()]
      .map(([p, e]) => `${p}: ${e.posts} posts, ${e.likes} likes, ${e.comments} comments, ${e.views} views`)
      .join(' | ') || 'No platform breakdown.',
    winners.length
      ? `${rankable ? 'TOP posts' : 'POSTS WITH THE MOST ENGAGEMENT (not a ranking — see evidence block)'}:\n${winners
          .map((w, i) => `  ${rankable ? `${i + 1}.` : '·'} [${w.platform}] score=${Math.round(w.score)} — ${w.caption || '(no caption)'}`)
          .join('\n')}`
      : 'No top posts.',
    losers.length
      ? `${rankable ? 'WEAK posts' : 'POSTS WITH THE LEAST ENGAGEMENT (not a ranking)'}:\n${losers
          .map((w) => `  [${w.platform}] score=${Math.round(w.score)} — ${w.caption || '(no caption)'}`)
          .join('\n')}`
      : '',
    insights ? `PATTERN INSIGHTS:\n${insights}` : '',
    `BLOG: ${blogPublished.length} published (views total ${blogViews}), ${blogDrafts.length} drafts.`,
    blogPublished.slice(0, 5).map((a) => `  · ${a.title} — ${viewsByArticle.get(a.id as string) ?? 0} views`).join('\n'),
    `SEO snapshot: DR ${seo.domainRating ?? 'n/a'}, traffic ${seo.traffic ?? 'n/a'}, organic kw ${seo.organicKeywords ?? 'n/a'}, new kw ${seo.keywordsNew ?? 'n/a'}, ref domains ${seo.referringDomains ?? 'n/a'}.`,
    pending.length
      ? `PENDING posts (editable):\n${pending.map((p) => `  id=${p.id} [${p.platform}] ${(p.caption ?? '').slice(0, 80)}`).join('\n')}`
      : '',
    scheduled.length
      ? `SCHEDULED posts (editable/reschedulable):\n${scheduled
          .map((p) => `  id=${p.id} [${p.platform}] @ ${p.scheduled_for ?? '?'} — ${(p.caption ?? '').slice(0, 60)}`)
          .join('\n')}`
      : '',
    blogDrafts.length
      ? `DRAFT articles:\n${blogDrafts.slice(0, 8).map((a) => `  id=${a.id} — ${a.title}`).join('\n')}`
      : '',
    // Only worth printing when it actually says something: a 'healthy' or 'unreadable' funnel is a
    // correct answer that costs prompt budget and teaches the agent nothing.
    funnel.stage === 'healthy' || funnel.stage === 'unreadable' ? '' : funnelBrief(funnel),
    evidenceBlock(evidence)
  ];

  return lines.filter(Boolean).join('\n');
}

export async function runAnalyticsReviewAgent(
  opts: AnalyticsReviewOpts
): Promise<AnalyticsReviewResult | null> {
  return withBrandContext(String(opts.brand.id), () => runAnalyticsReviewAgentInner(opts));
}

async function runAnalyticsReviewAgentInner(
  opts: AnalyticsReviewOpts
): Promise<AnalyticsReviewResult | null> {
  const admin = opts.supabase;
  const brand = opts.brand;
  const brandId = String(brand.id);
  const deadlineMs = opts.deadlineMs ?? 220_000;
  const t0 = Date.now();
  const language = localeLanguageName(
    (brand.content_prefs as AnyRec)?.language ? String((brand.content_prefs as AnyRec).language) : null
  );

  const digest = await buildAnalyticsDigest(admin, brandId);
  const usdBudget = Math.min(await fetchUsdBudget(brandId), 4);
  const budget: StrategyBudget = createStrategyBudget({
    searches: 6,
    drafts: 3,
    repairs: 3,
    usdRemaining: usdBudget
  });
  const usdStart = budget.usdRemaining;
  const tz = String(brand.timezone || 'Europe/Rome');
  const runMode = opts.mode ?? 'weekly';

  const state: {
    finished: AnalyticsReviewResult | null;
    actions: string[];
  } = { finished: null, actions: [] };
  const stallFingerprints: string[] = [];
  let stepNum = 0;

  const baseSystem = `You are Anomalia's analytics review agent. You turn REAL performance into concrete adaptations.

Brand: ${brand.name} (${brand.slug})
Language for all user-facing notes: ${language}
${opts.guidance ? `Owner guidance: ${opts.guidance}\n` : ''}
${buildClockSection(tz)}

Rules:
1. Start with read_performance (already summarized below — call it if you need a refresh).
2. Prefer PROPOSALS for strategy changes (propose_gtm_adjustment, propose_editorial_revision) — the owner approves in-app.
3. You MAY directly edit pending/scheduled SOCIAL posts and DRAFT blog articles when evidence is clear (weak captions, wrong timing, dead formats).
4. Do NOT invent metrics. Do NOT touch published posts' content. Do NOT activate plans yourself.
5. Write lasting lessons with remember_lesson when a pattern should stick for future generation.
6. Call finish with a short notes summary of what you changed/proposed and why.

EVIDENCE DISCIPLINE — read the QUALITÀ DELL'EVIDENZA block at the end of the digest before you conclude anything.
7. Never declare a winner the sample cannot support. When the block says the signal is insufficient, say the read is
   directional (or that there is none) and name what volume would settle it — "not enough signal to rank these, here is
   what to run to get it" is a legitimate and often correct output, not a failure to answer.
8. Match the action to the evidence. Reversible changes (a caption, a slot, next week's brief) may ship on a directional
   read. Irreversible ones (positioning, pricing, killing a format outright) need better than a trend, whatever the volume.
9. Respect the named traps. In particular: a drop from last period's best performer is partly arithmetic, not fatigue;
   posts we never published are invisible to this comparison; and impressions measure the algorithm's mood, not the
   content's value — weight replies, saves, profile visits and DMs instead.
10. Form your own read BEFORE looking at any conclusion the digest or the owner already reached, then say where you differ.
11. Never compute a fake precision. "Roughly 3x" is honest; "2.94x" from noisy inputs is theatre.
12. End your notes with what you could NOT determine. A stated gap is credible; a silently filled one is not.

Current digest:
${digest.slice(0, 6000)}`;

  const tools = {
    read_performance: tool({
      description: 'Refresh the analytics digest (social, blog, SEO, queue, winners/losers, patterns).',
      inputSchema: z.object({}),
      execute: async () => ({ digest: await buildAnalyticsDigest(admin, brandId) })
    }),

    read_plans: tool({
      description: 'Read active GTM + editorial plan summaries.',
      inputSchema: z.object({}),
      execute: async () => {
        const [gtm, editorial] = await Promise.all([
          loadActiveGtm(admin, brandId),
          loadActivePlan(admin, brandId)
        ]);
        return {
          gtm: gtm
            ? {
                id: gtm.id,
                objective: gtm.objective,
                phaseIndex: currentPhaseIndex(gtm, tz),
                phases: (gtm.phases ?? []).slice(0, 6).map((p: AnyRec, i: number) => ({
                  index: i,
                  name: p.name,
                  objective: p.objective,
                  start: p.start_date,
                  end: p.end_date
                }))
              }
            : null,
          editorial: editorial
            ? {
                strategy: editorial.strategy?.slice(0, 500),
                cadence: editorial.cadence,
                voice: editorial.voice,
                weeks: editorial.weeks?.map((w) => ({
                  index: w.index,
                  theme: w.theme,
                  focus: w.focus,
                  status: w.status
                }))
              }
            : null
        };
      }
    }),

    propose_gtm_adjustment: tool({
      description:
        'Compare GTM phase targets to real performance and, if needed, insert a PROPOSED GTM revision for owner approval (source=analytics_review).',
      inputSchema: z.object({
        reason: z.string().describe('Why this adjustment is warranted from the metrics.')
      }),
      execute: async ({ reason }) => {
        const gtm = await loadActiveGtm(admin, brandId);
        if (!gtm) return { error: 'No active GTM plan' };
        const phaseIdx = currentPhaseIndex(gtm, tz);
        if (phaseIdx == null) return { error: 'No current GTM phase' };
        const phase = gtm.phases[phaseIdx];
        if (!phase?.start_date || !phase?.end_date) return { error: 'Phase missing dates' };

        const [{ data: phasePosts }, { data: phaseHistory }, profile] = await Promise.all([
          admin
            .from('posts')
            .select('platform, published_at')
            .eq('brand_id', brandId)
            .eq('status', 'published')
            .gte('published_at', phase.start_date)
            .lt('published_at', phase.end_date),
          admin
            .from('social_post_history')
            .select('platform, metrics, published_at')
            .eq('brand_id', brandId)
            .eq('source', OWN_SOURCE) // OWN posts only — scraped rows are not the brand's performance
            .gte('published_at', phase.start_date)
            .lt('published_at', phase.end_date),
          plannerProfile(admin, { id: brandId, name: String(brand.name) })
        ]);

        const baseDigest = phasePerformanceDigest(phasePosts ?? [], phaseHistory ?? [], phase);
        const review = await reviewPhase(
          genaiClient(),
          gtm,
          phaseIdx,
          `${baseDigest}\n\nANALYTICS AGENT RATIONALE:\n${reason}\n\nFULL DIGEST:\n${digest.slice(0, 2500)}`,
          profile,
          language
        );

        if (review.verdict !== 'adjust' || !review.plan) {
          state.actions.push(`GTM on_track: ${review.message.slice(0, 160)}`);
          return { verdict: 'on_track', message: review.message };
        }

        const phases6m = gtm.phases_6m ?? gtm.phases;
        const mergedPhases = review.plan.phases.map((p, i) => ({
          ...p,
          start_date: phases6m[i]?.start_date ?? p.start_date,
          end_date: phases6m[i]?.end_date ?? p.end_date
        }));
        await admin.from('gtm_plans').update({ status: 'rejected' }).eq('brand_id', brandId).eq('status', 'proposed');
        const { data: row, error } = await admin
          .from('gtm_plans')
          .insert({
            brand_id: brandId,
            status: 'proposed',
            horizon: '6m',
            objective: review.plan.objective || null,
            phases: { horizon_90d: review.plan.phases_90d ?? [], horizon_6m: mergedPhases },
            funnel: review.plan.funnel ?? gtm.funnel ?? null,
            parent_id: gtm.id,
            reply: review.message,
            changes_summary: review.changes_summary,
            source: 'analytics_review'
          })
          .select('id')
          .maybeSingle();
        if (error) return { error: error.message };
        const msg = `GTM proposal ${row?.id}: ${review.changes_summary.join('; ') || review.message}`;
        state.actions.push(msg);
        return { verdict: 'adjust', plan_id: row?.id, changes: review.changes_summary, message: review.message };
      }
    }),

    propose_editorial_revision: tool({
      description:
        'Revise the editorial plan from performance feedback and insert it as PROPOSED for owner approval (source=analytics_review).',
      inputSchema: z.object({
        feedback: z
          .string()
          .describe('Concrete revision brief grounded in metrics (what to keep/change and why).')
      }),
      execute: async ({ feedback }) => {
        const current = await loadActivePlan(admin, brandId);
        if (!current) return { error: 'No active editorial plan' };
        const [profile, evidence, gtmBrief] = await Promise.all([
          plannerProfile(admin, { id: brandId, name: String(brand.name) }),
          planEvidence(admin, brandId),
          activeGtmBrief(admin, brandId, tz).catch((error) => { swallow('load gtm brief', error); return ''; })
        ]);
        const platforms = Array.isArray(brand.target_platforms)
          ? (brand.target_platforms as string[])
          : [];
        const revised = await revisePlan(genaiClient(), current, feedback, profile, {
          platforms,
          allowedCadences: cadenceAllowed(brand.plan),
          outputLanguage: language,
          strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
          benchmark: evidence.benchmark,
          topPosts: evidence.topPosts,
          supabase: admin,
          brandId,
          planTier: brand.plan,
          timezone: tz
        });
        await admin
          .from('editorial_plans')
          .update({ status: 'rejected' })
          .eq('brand_id', brandId)
          .eq('status', 'proposed');
        const { data: row, error } = await admin
          .from('editorial_plans')
          .insert({
            brand_id: brandId,
            status: 'proposed',
            strategy: revised.strategy || null,
            voice: revised.voice,
            cadence: revised.cadence,
            platform_mix: revised.platform_mix,
            gtm: revised.gtm,
            weeks: revised.weeks,
            changes_summary: revised.changes_summary ?? null,
            source: 'analytics_review'
          })
          .select('id')
          .maybeSingle();
        if (error) return { error: error.message };
        const msg = `Editorial proposal ${row?.id}: ${(revised.changes_summary ?? []).slice(0, 4).join('; ') || 'revised'}`;
        state.actions.push(msg);
        return {
          ok: true,
          plan_id: row?.id,
          changes_summary: revised.changes_summary ?? [],
          cadence: revised.cadence
        };
      }
    }),

    adjust_active_week: tool({
      description:
        'Light in-place tweak of an upcoming/active editorial week theme or brief (does not replace the whole plan). When updating the brief, include 2–3 explicit winning hooks from recent top posts so next week\'s craft can reuse what works.',
      inputSchema: z.object({
        week_index: z.number().int().min(0).max(3),
        theme: z.string().optional(),
        brief: z.string().optional(),
        focus: z.string().optional()
      }),
      execute: async ({ week_index, theme, brief, focus }) => {
        const { data: plan } = await admin
          .from('editorial_plans')
          .select('id, weeks')
          .eq('brand_id', brandId)
          .eq('status', 'active')
          .maybeSingle();
        if (!plan) return { error: 'No active editorial plan' };
        const weeks = [...((plan.weeks as AnyRec[]) ?? [])];
        if (!weeks[week_index]) return { error: 'Invalid week_index' };
        if (weeks[week_index].status === 'done' || weeks[week_index].status === 'planned') {
          return { error: 'Week already produced — use propose_editorial_revision instead' };
        }
        if (theme) weeks[week_index].theme = theme.slice(0, 200);
        let nextBrief = brief?.trim();
        if (nextBrief) {
          const { winningHookLines } = await import('$lib/server/platform-hygiene');
          const evidence = await planEvidence(admin, brandId).catch((error) => { swallow('load plan evidence', error); return null; });
          const topPosts = evidence?.topPosts ?? [];
          const hooks = winningHookLines(topPosts, 3);
          // "Winning" is a claim about causation, and on a handful of posts it is regression to the
          // mean wearing a leaderboard. Below the floor these are still the most-engaged openings —
          // worth showing, worth reusing, NOT worth calling winners in a brief the planner obeys.
          const proven = sampleVerdict(topPosts.length) !== 'insufficient';
          const hookLabel = proven
            ? "WINNING HOOKS (reuse patterns, don't copy)"
            : `MOST-ENGAGED OPENINGS SO FAR (${topPosts.length} post: segnale direzionale, non vincitori — riusa il taglio, non trattarli come una regola)`;
          if (hooks.length && !/WINNING HOOKS|MOST-ENGAGED OPENINGS/i.test(nextBrief)) {
            const hookBlock = `\n\n${hookLabel}: ${hooks.map((h) => `"${h}"`).join('; ')}`;
            // Reserve room for hooks so a max-length model brief doesn't erase them.
            const maxBrief = Math.max(0, 800 - hookBlock.length);
            nextBrief = `${nextBrief.slice(0, maxBrief).trimEnd()}${hookBlock}`.slice(0, 800);
          } else {
            nextBrief = nextBrief.slice(0, 800);
          }
        }
        if (nextBrief) weeks[week_index].brief = nextBrief;
        if (focus) weeks[week_index].focus = focus.slice(0, 300);
        const { error } = await admin.from('editorial_plans').update({ weeks }).eq('id', plan.id);
        if (error) return { error: error.message };
        const msg = `Week ${week_index} adjusted: ${theme || nextBrief || focus || 'updated'}`;
        state.actions.push(msg);
        return { ok: true, week_index };
      }
    }),

    rewrite_pending_post: tool({
      description:
        'Rewrite caption (and optional first_comment) on a pending_user or scheduled post. Re-syncs scheduled posts to Zernio.',
      inputSchema: z.object({
        post_id: z.string(),
        caption: z.string().min(1),
        first_comment: z.string().optional(),
        reason: z.string().optional()
      }),
      execute: async ({ post_id, caption, first_comment, reason }) => {
        const { data: post } = await admin
          .from('posts')
          .select(EDITOR_POST_COLS)
          .eq('id', post_id)
          .eq('brand_id', brandId)
          .maybeSingle();
        if (!post) return { error: 'Post not found' };
        if (!['pending_user', 'scheduled', 'approved'].includes(String(post.status))) {
          return { error: `Cannot edit status=${post.status}` };
        }
        const patch: AnyRec = { caption: caption.slice(0, 2200) };
        if (first_comment != null) patch.first_comment = first_comment.slice(0, 500);
        const { error } = await admin.from('posts').update(patch).eq('id', post_id).eq('brand_id', brandId);
        if (error) return { error: error.message };
        if (post.status === 'scheduled' && post.scheduled_for) {
          try {
            await requireZernioCancellation(admin, post_id);
            const { data: fresh } = await admin
              .from('posts')
              .select(EDITOR_POST_COLS)
              .eq('id', post_id)
              .eq('brand_id', brandId)
              .maybeSingle();
            if (fresh) await publishApprovedPost(admin, fresh as ApprovablePost, tz);
          } catch (e) {
            return { warning: `Saved but Zernio re-sync failed: ${e instanceof Error ? e.message : e}` };
          }
        }
        const msg = `Rewrote post ${post_id}${reason ? ` (${reason.slice(0, 80)})` : ''}`;
        state.actions.push(msg);
        return { ok: true, post_id };
      }
    }),

    reschedule_pending_post: tool({
      description: 'Move a scheduled/approved/pending post to a better time.',
      inputSchema: z.object({
        post_id: z.string(),
        scheduled_for: z.string().describe(`Datetime in the brand's local time (${tz}) — e.g. "2026-08-09T18:00". Add a Z/offset only for a real UTC instant.`),
        reason: z.string().optional()
      }),
      execute: async ({ post_id, scheduled_for, reason }) => {
        const parsed = resolveScheduleInput(scheduled_for, tz);
        if ('error' in parsed) return parsed;
        const { data: post } = await admin
          .from('posts')
          .select(EDITOR_POST_COLS)
          .eq('id', post_id)
          .eq('brand_id', brandId)
          .maybeSingle();
        if (!post) return { error: 'Post not found' };
        if (!['pending_user', 'scheduled', 'approved'].includes(String(post.status))) {
          return { error: `Cannot reschedule status=${post.status}` };
        }
        const iso = parsed.utc;
        try {
          await requireZernioCancellation(admin, post_id);
          await admin.from('posts').update({ scheduled_for: iso }).eq('id', post_id).eq('brand_id', brandId);
          const { data: fresh } = await admin
            .from('posts')
            .select(EDITOR_POST_COLS)
            .eq('id', post_id)
            .eq('brand_id', brandId)
            .maybeSingle();
          if (!fresh) return { error: 'Post not found after update' };
          await publishApprovedPost(admin, fresh as ApprovablePost, tz);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
        const msg = `Rescheduled ${post_id} → ${parsed.local}${reason ? ` (${reason.slice(0, 80)})` : ''}`;
        state.actions.push(msg);
        return { ok: true, post_id, scheduled_for: iso, scheduled_for_local: parsed.local };
      }
    }),

    revise_draft_article: tool({
      description: 'Update a draft/approved blog article title, meta, or body from performance learnings.',
      inputSchema: z.object({
        article_id: z.string(),
        title: z.string().optional(),
        meta_title: z.string().optional(),
        meta_description: z.string().optional(),
        body_md: z.string().optional().describe('Full markdown body if rewriting'),
        reason: z.string().optional()
      }),
      execute: async ({ article_id, title, meta_title, meta_description, body_md, reason }) => {
        const { data: article } = await admin
          .from('brand_articles')
          .select('id, status')
          .eq('id', article_id)
          .eq('brand_id', brandId)
          .maybeSingle();
        if (!article) return { error: 'Article not found' };
        if (!['draft', 'approved'].includes(String(article.status))) {
          return { error: `Cannot edit status=${article.status}` };
        }
        const patch: AnyRec = {};
        if (title) patch.title = title.slice(0, 200);
        if (meta_title) patch.meta_title = meta_title.slice(0, 70);
        if (meta_description) patch.meta_description = meta_description.slice(0, 170);
        if (body_md) patch.body_md = body_md.slice(0, 80000);
        if (!Object.keys(patch).length) return { error: 'No changes' };
        const { error } = await admin
          .from('brand_articles')
          .update(patch)
          .eq('id', article_id)
          .eq('brand_id', brandId);
        if (error) return { error: error.message };
        const msg = `Revised article ${article_id}${reason ? ` (${reason.slice(0, 80)})` : ''}`;
        state.actions.push(msg);
        return { ok: true, updated: Object.keys(patch) };
      }
    }),

    remember_lesson: tool({
      description: 'Persist a lasting analytics lesson into brand memory for future generation.',
      inputSchema: z.object({
        key: z.string().describe('Short stable key, e.g. format.avoid_carousel_weekdays'),
        value: z.string().describe('The lesson in one or two sentences.'),
        category: z.enum(['insight', 'preference', 'constraint', 'voice', 'fact']).optional()
      }),
      execute: async ({ key, value, category }) => {
        await writeMemory(admin, brandId, {
          category: category ?? 'insight',
          key: key.slice(0, 120),
          value: value.slice(0, 800),
          source: 'analysis',
          confidence: 0.75,
          layer: 'project'
        });
        state.actions.push(`Memory: ${key}`);
        return { ok: true };
      }
    }),

    finish: tool({
      description: 'Complete the review with a summary of proposals and edits.',
      inputSchema: z.object({
        notes: z.string().describe('Owner-facing summary of what changed and why.')
      }),
      execute: async ({ notes }) => {
        state.finished = {
          notes: notes.trim(),
          actions: [...state.actions],
          costUsd: Math.max(0, usdStart - budget.usdRemaining)
        };
        return { ok: true, actions: state.actions.length };
      }
    })
  };

  const stallStop: StopCondition<typeof tools> = () =>
    stallDetected(stallFingerprints, STALL_STEP_THRESHOLD);
  // Reassigned by withAgentFallback when the primary dies before any tool ran — everything
  // billed below must name the model that actually served the loop.
  let loopModel = agentModel();
  let loopOk = true;
  let loopError: string | undefined;

  try {
    await withAgentFallback('analyticsReviewAgent', (chosen, markDirty) => {
      loopModel = chosen;
      return harnessGenerateText({
        brandId,
        userId: opts.userId,
        agent: 'analytics_review',
        mode: runMode,
        model: loopModel.modelId,
        provider: loopModel.provider,
        surface: 'batch'
      }, {
        model: loopModel.model,
        maxOutputTokens: maxOutputTokensFor(loopModel.provider),
        system: baseSystem,
        prompt:
          'Review this brand\'s analytics and adapt strategy, editorial plan, and upcoming content where the evidence is clear. Prefer proposals for GTM/editorial; edit pending/scheduled posts and draft articles directly when useful. Finish with notes.',
        tools,
        stopWhen: [
          hasToolCall('finish'),
          stepCountIs(MAX_ANALYTICS_REVIEW_STEPS),
          stallStop,
          () => deadlineReached(t0, deadlineMs)
        ],
        temperature: 0.35,
        prepareStep: () => {
          const remainingSec = Math.max(0, Math.round((deadlineMs - (Date.now() - t0)) / 1000));
          return { system: appendBudgetToSystem(baseSystem, budget, remainingSec) };
        },
        onStepFinish: ({ usage, toolCalls, text }) => {
          addStrategyStepCost(budget, usage, loopModel);
          stallFingerprints.push(
            stepFingerprint(
              { a: state.actions.length, u: budget.usdRemaining },
              toolCalls?.map((tc) => ({ toolName: tc.toolName, input: 'input' in tc ? tc.input : undefined }))
            )
          );
          stepNum += 1;
          if (opts.verbose) {
            console.log(
              `[analytics-review] step ${stepNum}`,
              toolCalls?.map((tc) => tc.toolName).join(',') || text?.slice(0, 80)
            );
          }
        }
      }, { before: [() => { markDirty(); }] });
    });
  } catch (e) {
    loopOk = false;
    loopError = e instanceof Error ? e.message : String(e);
  }

  const finished = state.finished;
  const costUsd = Math.max(0, usdStart - budget.usdRemaining);
  logAiCall({
    label: 'analyticsReviewAgent',
    provider: loopModel.provider,
    model: loopModel.modelId,
    ms: Date.now() - t0,
    ok: loopOk && !!finished,
    error: loopError,
    flatCostUsd: costUsd || undefined
  });

  persistAgentRun({
    brandId,
    userId: opts.userId,
    agent: 'analytics_review',
    mode: runMode,
    status: finished ? 'finished' : state.actions.length ? 'fallback' : 'failed',
    finishedOk: !!finished,
    notes: finished?.notes ?? state.actions.join('\n').slice(0, 2000),
    costUsdEstimate: costUsd
  });

  if (finished) return { ...finished, costUsd };
  if (state.actions.length) {
    return {
      notes: 'Agent ended without finish; applied partial actions.',
      actions: state.actions,
      costUsd
    };
  }
  return null;
}
