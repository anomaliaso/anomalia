/**
 * Onboarding step work as durable background jobs (kind-scoped).
 *
 * Competitor discovery, strategy research, post planning and image render used to run inside the
 * NDJSON request the wizard held open. Mobile Safari (and any brief navigation away) dropped that
 * connection and the user saw a false failure even when the server had already finished. Each step
 * now enqueues a row on `onboarding_step_jobs`, a worker runs it, and the page polls until done.
 * Leaving the tab no longer cancels the work.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { createAdminClient } from '$lib/server/supabase-admin';
import type { PastWinner } from '$lib/server/content-preview';
import { planPreviewPosts, renderPreviewImages, type ContentPrefs, type PreviewPost } from '$lib/server/content-preview';
import { proposePlan, cadenceAllowed, normalizePlan, weekStrategyBrief, postsForWeek, CADENCES } from '$lib/server/editorial-plan';
import { upcomingTimelyHooks } from '$lib/server/thematic-calendar';
import { scrapeForOnboarding, type ScrapeTarget } from '$lib/server/scrapecreators';
import { synthesizeBrandContext, synthesizeVisualStyle, synthesizeVisualPlaybook } from '$lib/server/brand-context';
import { analyzePostHistory, historyInsightsDigest } from '$lib/server/post-history-insights';
import {
  genaiClient,
  discoverCompetitors,
  resolveCompetitorHandles,
  scrapeCompetitors,
  benchmarkCompetitors,
  analyzeCompetitorContent,
  synthesizeStrategyReport,
  buildCompetitiveContext,
  strategyBriefFromReport,
  generateBuyerPersonas,
  type CompetitorCandidate,
  type BuyerPersona
} from '$lib/server/research';
import { logOnboardingError } from '$lib/server/onboarding-errors';
import { withBrandContext } from '$lib/server/ai-log';

export type OnboardingStepKind = 'competitors' | 'research' | 'plan_posts' | 'preview_images';

export type OnboardingStepJobStatus = 'pending' | 'running' | 'done' | 'failed';

export type OnboardingStepJobRow = {
  id: string;
  user_id: string;
  draft_id: string | null;
  brand_id: string | null;
  kind: OnboardingStepKind;
  status: OnboardingStepJobStatus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  progress: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: Record<string, any> | null;
  error: string | null;
  attempts: number;
  notify_email_sent_at?: string | null;
};

const MAX_ATTEMPTS = 3;

/**
 * A claimed job can never outlive the worker invocation running it, and that is capped at the
 * platform's 300s `maxDuration`. So the stall window is one number, not one per kind: anything
 * shorter re-queues a job that is still running (double spend), anything longer just adds dead
 * waiting after a kill. 300s + 60s of slack for clock skew and the final status write.
 */
const STALL_MS = 6 * 60 * 1000;

const TABLE = 'onboarding_step_jobs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseHandles(raw: any): ScrapeTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((h: any) => ({
      platform: String(h?.platform ?? '').toLowerCase(),
      username: h?.username ? String(h.username).trim().replace(/^@/, '') : null,
      profileUrl: h?.profileUrl ? String(h.profileUrl).trim() : null
    }))
    .filter((h) => h.platform && (h.username || h.profileUrl));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCompetitors(raw: any): Array<CompetitorCandidate & { source: 'ai' | 'user' }> {
  if (!Array.isArray(raw)) return [];
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((c: any) => ({
      name: String(c?.name ?? '').trim(),
      website: String(c?.website ?? '').trim(),
      kind: c?.kind === 'indirect' ? ('indirect' as const) : ('direct' as const),
      rationale: String(c?.rationale ?? '').trim(),
      source: c?.source === 'user' ? ('user' as const) : ('ai' as const)
    }))
    .filter((c) => c.name);
}

async function patchJob(
  admin: SupabaseClient,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patch: Record<string, any>
): Promise<void> {
  await admin
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
}

/** Progress the wizard polls — step + human message only (result payloads go via patchPartialResult). */
async function note(
  admin: SupabaseClient,
  jobId: string,
  step: string,
  message: string
): Promise<void> {
  await patchJob(admin, jobId, { progress: { step, message } });
}

/**
 * Merge into result jsonb so polling clients see intermediate data (posts as they land, research
 * report as soon as it exists) without waiting for status=done.
 */
async function patchPartialResult(
  admin: SupabaseClient,
  jobId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  partial: Record<string, any>
): Promise<void> {
  const { data } = await admin.from(TABLE).select('result').eq('id', jobId).maybeSingle();
  const prev =
    data?.result && typeof data.result === 'object' && !Array.isArray(data.result)
      ? (data.result as Record<string, unknown>)
      : {};
  await patchJob(admin, jobId, { result: { ...prev, ...partial } });
}

/** Merge a patch into onboarding_drafts.draft so a later resume shows data even if the job row is GC'd. */
async function mirrorDraft(
  admin: SupabaseClient,
  draftId: string | null,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patch: Record<string, any>
): Promise<void> {
  if (!draftId) return;
  try {
    const { data: draftRow } = await admin
      .from('onboarding_drafts')
      .select('draft')
      .eq('id', draftId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!draftRow) return;
    const prev =
      draftRow.draft && typeof draftRow.draft === 'object'
        ? (draftRow.draft as Record<string, unknown>)
        : {};
    await admin
      .from('onboarding_drafts')
      .update({
        draft: { ...prev, ...patch },
        updated_at: new Date().toISOString()
      })
      .eq('id', draftId)
      .eq('user_id', userId);
  } catch (e) {
    console.error('[onboarding-steps] draft mirror failed:', e);
  }
}

/** Fire-and-forget nudge so a job starts without waiting for the next cron tick. */
export async function kickOnboardingStepWork(origin: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (env.AUTOPILOT_SECRET) headers['x-autopilot-secret'] = env.AUTOPILOT_SECRET;
  else if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
  await fetch(`${origin}/api/v1/onboarding/steps/work`, { method: 'POST', headers }).catch(swallow('fetch failed'));
}

/**
 * Enqueue (or reattach to) a step job for this user/brand/kind. Returns the job id the page polls.
 * When `force` is false and a live/recent-done job already exists for the brand+kind, reuses it so
 * re-entering the step doesn't burn another expensive run.
 *
 * `supabase` is the caller's user-scoped client and is used for READS only (RLS scopes them to the
 * owner). Every write goes through the service role: the table has no insert/update policy, so a
 * user can't enqueue a job straight against PostgREST — bypassing the route's canEnter() gate — or
 * flip a finished job back to `pending` to make the worker re-run the whole pipeline for free.
 */
export async function startOnboardingStepJob(
  supabase: SupabaseClient,
  opts: {
    kind: OnboardingStepKind;
    userId: string;
    brandId: string | null;
    draftId: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: Record<string, any>;
    force?: boolean;
  }
): Promise<{ jobId: string; reused: boolean }> {
  const { kind, userId, brandId, draftId, input, force = false } = opts;

  if (!force && brandId) {
    const { data: live } = await supabase
      .from(TABLE)
      .select('id, status')
      .eq('user_id', userId)
      .eq('brand_id', brandId)
      .eq('kind', kind)
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (live?.id) return { jobId: live.id as string, reused: true };

    // A just-finished job for the same brand+kind: reattach so a refresh after success doesn't re-run.
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from(TABLE)
      .select('id')
      .eq('user_id', userId)
      .eq('brand_id', brandId)
      .eq('kind', kind)
      .eq('status', 'done')
      .gte('completed_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent?.id) return { jobId: recent.id as string, reused: true };
  }

  const admin = createAdminClient();

  if (force && brandId) {
    // Supersede any in-flight job for this brand+kind so the worker doesn't race two runs.
    await admin
      .from(TABLE)
      .update({
        status: 'failed',
        error: 'superseded',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('brand_id', brandId)
      .eq('kind', kind)
      .in('status', ['pending', 'running']);
  }

  const { data, error } = await admin
    .from(TABLE)
    .insert({
      user_id: userId,
      draft_id: draftId,
      brand_id: brandId,
      kind,
      status: 'pending',
      progress: { step: 'queued', message: 'Queued…' },
      input
    })
    .select('id')
    .single();
  if (error || !data?.id) throw new Error(error?.message ?? 'Failed to enqueue onboarding step job');
  return { jobId: data.id as string, reused: false };
}

/** Owner-scoped poll payload for the wizard. */
export async function getOnboardingStepJob(
  supabase: SupabaseClient,
  userId: string,
  jobId: string
): Promise<OnboardingStepJobRow | null> {
  const { data } = await supabase
    .from(TABLE)
    .select(
      'id, user_id, draft_id, brand_id, kind, status, progress, input, result, error, attempts, notify_email_sent_at'
    )
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as OnboardingStepJobRow | null) ?? null;
}

/** Latest job for a brand+kind — used to resume continue-mode onboarding after a tab leave. */
export async function latestOnboardingStepJob(
  supabase: SupabaseClient,
  userId: string,
  brandId: string,
  kind: OnboardingStepKind
): Promise<OnboardingStepJobRow | null> {
  const { data } = await supabase
    .from(TABLE)
    .select(
      'id, user_id, draft_id, brand_id, kind, status, progress, input, result, error, attempts, notify_email_sent_at'
    )
    .eq('user_id', userId)
    .eq('brand_id', brandId)
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as OnboardingStepJobRow | null) ?? null;
}

/**
 * Claim up to `limit` pending (or stalled running) jobs FIFO. `skip` holds ids this invocation has
 * already run: a job that failed and re-queued itself must not be re-claimed by the same worker,
 * or all MAX_ATTEMPTS burn back-to-back in seconds (a transient 429 would cost three full
 * pipelines). Leaving it pending hands it to the next kick / cron tick instead.
 */
export async function claimOnboardingStepJobs(
  admin: SupabaseClient,
  limit = 2,
  skip: Iterable<string> = []
): Promise<string[]> {
  const skipIds = [...skip];

  // Re-queue jobs whose worker died mid-run (see STALL_MS).
  const { data: running } = await admin
    .from(TABLE)
    .select('id, attempts, started_at')
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - STALL_MS).toISOString())
    .limit(50);

  for (const row of running ?? []) {
    const attempts = (row.attempts as number) ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      await patchJob(admin, row.id as string, {
        status: 'failed',
        error: `Job timed out after ${MAX_ATTEMPTS} attempts`,
        completed_at: new Date().toISOString()
      });
    } else {
      await patchJob(admin, row.id as string, {
        status: 'pending',
        started_at: null,
        error: 'stalled — requeued'
      });
    }
  }

  let query = admin
    .from(TABLE)
    .select('id, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (skipIds.length) query = query.not('id', 'in', `(${skipIds.join(',')})`);
  const { data: pending } = await query;

  const ids: string[] = [];
  for (const row of pending ?? []) {
    const id = row.id as string;
    const { data: claimed } = await admin
      .from(TABLE)
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        attempts: ((row.attempts as number) ?? 0) + 1
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (claimed?.id) ids.push(claimed.id as string);
  }
  return ids;
}

async function failOrRetry(
  admin: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: Record<string, any>,
  message: string,
  progressFailed: { step: string; message: string }
): Promise<void> {
  const attempts = (job.attempts as number) ?? 1;
  const failed = attempts >= MAX_ATTEMPTS;
  await patchJob(admin, job.id as string, {
    status: failed ? 'failed' : 'pending',
    error: message.slice(0, 2000),
    started_at: failed ? job.started_at : null,
    completed_at: failed ? new Date().toISOString() : null,
    progress: failed ? progressFailed : { step: 'queued', message: 'Retrying…' }
  });
}

// ── competitors ──────────────────────────────────────────────────────────────

async function processCompetitors(
  admin: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: Record<string, any>
): Promise<void> {
  const jobId = job.id as string;
  const input = (job.input ?? {}) as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile?: Record<string, any>;
    platforms?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handles?: any;
    outputLanguage?: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile: Record<string, any> = { ...(input.profile ?? {}) };
  const platforms = Array.isArray(input.platforms) ? input.platforms : [];
  const handles = parseHandles(input.handles);
  const outputLanguage = input.outputLanguage || 'English';
  const brandId = (job.brand_id as string | null) ?? null;
  const userId = job.user_id as string;

  const run = async () => {
    try {
      const ai = genaiClient();

      // Creator path (no analyzed website): read their socials so discovery has niche + voice.
      const hasSite = !!(profile?.url || profile?.website);
      if (!hasSite && handles.length && !profile?.ai_context) {
        await note(admin, jobId, 'reading', 'Reading your posts…');
        try {
          const { posts } = await scrapeForOnboarding(handles);
          if (posts.length) {
            const ctx = await synthesizeBrandContext(ai, {
              name: profile?.name ?? '',
              kit: {
                about: profile?.about,
                category: profile?.category,
                target_audience: profile?.target_audience
              },
              documents: [],
              posts: posts.map((p) => ({ content: p.content, platform: p.platform, metrics: p.metrics }))
            });
            if (ctx) profile.ai_context = ctx;
          }
        } catch (error) { swallow('synthesize brand context', error); }
      }

      await note(admin, jobId, 'scanning', 'Scanning the market for your competitors…');
      const { competitors, citations } = await discoverCompetitors(ai, profile, outputLanguage);
      await note(admin, jobId, 'found', `Found ${competitors.length} competitors`);

      const result = { competitors, citations, platforms };
      await patchJob(admin, jobId, {
        status: 'done',
        result,
        error: null,
        completed_at: new Date().toISOString(),
        progress: { step: 'found', message: `Found ${competitors.length} competitors` }
      });

      const aiComps = competitors.map((c) => ({ ...c, source: 'ai' as const }));
      await mirrorDraft(admin, job.draft_id as string | null, userId, {
        competitors: aiComps,
        citations,
        competitorJobId: jobId
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await logOnboardingError(admin, userId, 'competitors', e, {
        hasSite: !!(profile?.url || profile?.website),
        handles: handles.length,
        jobId
      });
      await failOrRetry(admin, job, message, {
        step: 'error',
        message: 'Competitor discovery failed'
      });
    }
  };

  if (brandId) await withBrandContext(brandId, run);
  else await run();
}

// ── research ─────────────────────────────────────────────────────────────────

async function processResearch(
  admin: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: Record<string, any>
): Promise<void> {
  const jobId = job.id as string;
  const input = (job.input ?? {}) as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile?: Record<string, any>;
    platforms?: string[];
    plan?: string | null;
    planTier?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handles?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    competitors?: any;
    additionalContext?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    people?: any;
    outputLanguage?: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile: Record<string, any> = { ...(input.profile ?? {}) };
  const platforms: string[] = Array.isArray(input.platforms) ? input.platforms : [];
  const planTier =
    typeof input.planTier === 'string'
      ? input.planTier
      : typeof input.plan === 'string'
        ? input.plan
        : null;
  const brandHandles = parseHandles(input.handles);
  const competitors = parseCompetitors(input.competitors);
  const additionalContext =
    typeof input.additionalContext === 'string' ? input.additionalContext.trim() : '';
  const outputLanguage = input.outputLanguage || 'English';
  if (Array.isArray(input.people) && input.people.length) profile.people = input.people;

  const brandId = (job.brand_id as string | null) ?? null;
  const userId = job.user_id as string;
  let lastStep = 'start';

  // Accumulate timeline steps + partial payloads so the poll UI can render progress live.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps: Array<{ step: string; message: string; result?: any }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let accumulated: Record<string, any> = { steps };

  const pushProgress = async (step: string, message: string) => {
    lastStep = step;
    steps.push({ step, message });
    accumulated = { ...accumulated, steps: [...steps] };
    await note(admin, jobId, step, message);
    await patchPartialResult(admin, jobId, { steps: [...steps] });
  };

  // Attach tangible stepResult onto the matching progress step (last occurrence).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachStepResult = async (step: string, data: any) => {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].step === step) {
        steps[i] = { ...steps[i], result: data };
        break;
      }
    }
    accumulated = { ...accumulated, steps: [...steps] };
    await patchPartialResult(admin, jobId, { steps: [...steps] });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mergeResult = async (partial: Record<string, any>) => {
    accumulated = { ...accumulated, ...partial, steps: [...steps] };
    await patchPartialResult(admin, jobId, partial);
  };

  const run = async () => {
    try {
      const ai = genaiClient();

      // Phase 1 (parallel): scrape the brand's own posts while resolving competitor social handles.
      await pushProgress('handles', 'Finding competitor profiles…');
      const [brandScrape, handleMap] = await Promise.all([
        brandHandles.length
          ? scrapeForOnboarding(brandHandles).catch((error) => { swallow('scrape onboarding profile', error); return ({ posts: [], errors: [] }); })
          : Promise.resolve({ posts: [], errors: [] }),
        competitors.length
          ? resolveCompetitorHandles(ai, competitors, platforms)
          : Promise.resolve(new Map<string, ScrapeTarget[]>())
      ]);
      const brandPosts = brandScrape.posts;
      if (competitors.length) {
        await attachStepResult('handles', {
          competitors: competitors.map((c) => ({
            name: c.name,
            handles: (handleMap.get(c.name) ?? []).map((h) => ({
              platform: h.platform,
              username: h.username
            }))
          }))
        });
      }
      if (brandPosts.length) {
        await pushProgress(
          'brandHistory',
          `Retrieved ${brandPosts.length} of your posts with their stats — saved to your brand…`
        );
      }

      // Phase 2: scrape competitor posts WHILE brand-only LLM work runs.
      await pushProgress('scraping', 'Reading your competitors’ posts…');
      const topThumbs = [...brandPosts]
        .sort(
          (a, b) =>
            (b.metrics?.likes ?? 0) +
            (b.metrics?.comments ?? 0) -
            ((a.metrics?.likes ?? 0) + (a.metrics?.comments ?? 0))
        )
        .map((p) => p.thumbnailUrl)
        .filter((u): u is string => !!u);

      const brandWork = Promise.all([
        brandPosts.length
          ? synthesizeBrandContext(ai, {
              name: profile?.name ?? '',
              kit: {
                about: profile?.about,
                category: profile?.category,
                target_audience: profile?.target_audience
              },
              documents: [],
              posts: brandPosts.map((p) => ({
                content: p.content,
                platform: p.platform,
                metrics: p.metrics
              }))
            }).catch((error) => { swallow('brandPosts.map failed', error); return ''; })
          : Promise.resolve(''),
        brandPosts.length ? synthesizeVisualStyle(ai, topThumbs).catch((error) => { swallow('synthesize visual style', error); return ''; }) : Promise.resolve(''),
        brandPosts.length
          ? synthesizeVisualPlaybook(ai, topThumbs).catch((error) => { swallow('synthesize visual playbook', error); return ''; })
          : Promise.resolve(''),
        generateBuyerPersonas(ai, profile, competitors, platforms, outputLanguage).catch((error) => { swallow('generate buyer personas', error); return [] as BuyerPersona[]; })
      ]);

      const [competitorPosts, [brandCtx, brandStyle, visualPlaybook, buyerPersonas]] =
        await Promise.all([scrapeCompetitors(handleMap), brandWork]);

      if (competitorPosts.size) {
        await attachStepResult('scraping', {
          counts: [...competitorPosts.entries()].map(([name, posts]) => ({
            name,
            posts: posts.length
          }))
        });
      }
      if (brandStyle) profile.visual_style = brandStyle;

      // Phase 3: quantitative benchmark + qualitative field read.
      await pushProgress('benchmark', 'Comparing engagement across the field…');
      const benchmark = benchmarkCompetitors(brandPosts, competitorPosts);
      await attachStepResult('benchmark', {
        market: benchmark.market,
        brand: benchmark.brand
          ? {
              count: benchmark.brand.count,
              medianEngagement: benchmark.brand.medianEngagement,
              postsPerWeek: benchmark.brand.postsPerWeek
            }
          : null,
        competitors: benchmark.competitors.map((c) => ({
          name: c.name,
          count: c.stats.count,
          medianEngagement: c.stats.medianEngagement,
          postsPerWeek: c.stats.postsPerWeek
        }))
      });

      await pushProgress('analysis', 'Studying what wins in your category…');
      const qualitative = await analyzeCompetitorContent(ai, benchmark, outputLanguage);
      if (qualitative) {
        await attachStepResult('analysis', { text: qualitative });
      }

      // Phase 4: strategy report — onboarding uses ultraspeed + a single variant so this doesn't stall.
      await pushProgress('strategy', 'Mapping your white space…');
      let baseContext = brandCtx || profile?.ai_context || '';
      if (additionalContext) {
        baseContext = [baseContext, `ADDITIONAL CONTEXT FROM USER:\n${additionalContext}`]
          .filter(Boolean)
          .join('\n\n');
      }
      const histDigest = historyInsightsDigest(analyzePostHistory(brandPosts));
      if (histDigest) baseContext = [baseContext, histDigest].filter(Boolean).join('\n\n');
      if (visualPlaybook) baseContext = [baseContext, visualPlaybook].filter(Boolean).join('\n\n');
      profile.ai_context = baseContext;

      const { XIAOMI_ULTRASPEED_MODEL, AI_PROVIDER } = await import('$lib/server/xiaomi');
      const fastModel = AI_PROVIDER === 'xiaomi' ? XIAOMI_ULTRASPEED_MODEL : undefined;

      const report = await synthesizeStrategyReport(
        ai,
        profile,
        benchmark,
        qualitative,
        platforms,
        outputLanguage,
        { model: fastModel, variants: 1 }
      );

      profile.ai_context = buildCompetitiveContext(baseContext, report);
      const strategyBrief = strategyBriefFromReport(report);

      await mergeResult({ report, buyerPersonas });

      const resolvedCompetitors = competitors.map((c) => {
        const cb = benchmark.competitors.find((b) => b.name === c.name);
        return {
          ...c,
          handles: handleMap.get(c.name) ?? [],
          top_posts: cb?.stats.topPosts ?? [],
          benchmark: cb?.stats ?? null
        };
      });
      const researchData = {
        competitors: resolvedCompetitors,
        report,
        benchmark,
        positioning: qualitative,
        personas: buyerPersonas
      };
      await mergeResult({ researchData });

      await pushProgress('editorialPlan', 'Drafting your editorial plan…');
      const topPosts: PastWinner[] = brandPosts.map((p) => ({
        content: p.content,
        platform: p.platform,
        metrics: p.metrics
      }));
      const calendarHooks = await upcomingTimelyHooks({
        category: profile?.category,
        archetype: profile?.site_type,
        language: profile?.language
      }).catch((error) => { swallow('find timely hooks', error); return ''; });
      const allowedCadences = cadenceAllowed(planTier);
      const editorialPlan = await proposePlan(ai, profile, {
        platforms,
        allowedCadences,
        outputLanguage,
        strategyBrief,
        benchmark,
        topPosts,
        zeroToOne: brandPosts.length < 10,
        calendarHooks,
        model: fastModel,
        variants: 1,
        supabase: admin,
        brandId: brandId ?? undefined,
        planTier
      });
      const planVisualStyle = profile?.visual_style ?? null;
      await mergeResult({
        editorialPlan,
        allowedCadences,
        planVisualStyle
      });

      const result = {
        ...accumulated,
        steps: [...steps],
        report,
        buyerPersonas,
        researchData,
        editorialPlan,
        allowedCadences,
        planVisualStyle
      };
      await patchJob(admin, jobId, {
        status: 'done',
        result,
        error: null,
        completed_at: new Date().toISOString(),
        progress: { step: 'done', message: 'Research complete' }
      });

      await mirrorDraft(admin, job.draft_id as string | null, userId, {
        report,
        buyerPersonas,
        researchData,
        editorialPlan,
        allowedCadences,
        planVisualStyle,
        researchJobId: jobId,
        researchSteps: steps
      });

      // Email is the durable signal that the long market-study step finished — the wizard may have
      // been closed for minutes while this ran.
      await notifyStrategyPlanReady(admin, job, {
        weeks: Array.isArray(editorialPlan?.weeks) ? editorialPlan.weeks.length : 4
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await logOnboardingError(admin, userId, 'research', e, {
        lastStep,
        platforms,
        competitors: competitors.length,
        handles: brandHandles.length,
        jobId
      });
      await failOrRetry(admin, job, message, {
        step: 'error',
        message: 'Research failed'
      });
    }
  };

  // Attribute AI spend to the brand when we have one (same as the stream handler).
  if (brandId) await withBrandContext(brandId, run);
  else await run();
}

/**
 * Email + push when research finishes. Idempotent via notify_email_sent_at — worker retries must
 * never spam the user. Failures are soft: the job stays done either way.
 */
async function notifyStrategyPlanReady(
  admin: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: Record<string, any>,
  opts: { weeks: number }
): Promise<void> {
  const brandId = (job.brand_id as string | null) ?? null;
  if (!brandId) return;

  // Claim the send slot first so concurrent worker retries can't double-email.
  const { data: claimed } = await admin
    .from(TABLE)
    .update({
      notify_email_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', job.id as string)
    .is('notify_email_sent_at', null)
    .select('id')
    .maybeSingle();
  if (!claimed) return;

  const { data: brand } = await admin
    .from('brands')
    .select('id, name, slug, org_id')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand?.slug) {
    await patchJob(admin, job.id as string, { notify_email_sent_at: null });
    return;
  }

  const { brandContacts } = await import('$lib/server/scheduler');
  let contacts = brand.org_id
    ? await brandContacts(admin, brand.org_id as string, brandId)
    : [];
  if (!contacts.length) {
    const { data: profile } = await admin
      .from('profiles')
      .select('id, email, locale')
      .eq('id', job.user_id as string)
      .maybeSingle();
    if (profile?.email) {
      contacts = [
        {
          userId: profile.id as string,
          email: profile.email as string,
          locale: (profile.locale as string | null) ?? null
        }
      ];
    }
  }
  if (!contacts.length) {
    await patchJob(admin, job.id as string, { notify_email_sent_at: null });
    return;
  }

  const {
    strategyPlanReadyEmailSubject,
    strategyPlanReadyEmailHtml,
    strategyPlanReadyEmailText
  } = await import('$lib/server/email');
  const { notifyBrandContacts } = await import('$lib/server/brand-notify');
  const { siteUrl } = await import('$lib/seo');

  const name = (brand.name as string) || 'your brand';
  const slug = brand.slug as string;
  const weeks = Math.max(1, opts.weeks || 4);
  // Setup continues in the brand dashboard chat, not the legacy onboarding wizard.
  const continueUrl = `${siteUrl()}/app/${encodeURIComponent(slug)}`;

  try {
    await notifyBrandContacts(admin, contacts, {
      buildEmail: (locale, to) => ({
        to,
        subject: strategyPlanReadyEmailSubject(locale, name),
        html: strategyPlanReadyEmailHtml(locale, name, weeks, continueUrl),
        text: strategyPlanReadyEmailText(locale, name, weeks, continueUrl)
      }),
      push: {
        url: continueUrl,
        tag: `onboarding-strategy-ready-${brandId}`,
        body: (locale) => strategyPlanReadyEmailSubject(locale, name)
      },
      logPrefix: 'onboarding-research'
    });
  } catch (e) {
    // Allow a later retry to try again (email never left).
    await patchJob(admin, job.id as string, { notify_email_sent_at: null });
    await logOnboardingError(admin, job.user_id as string, 'research_notify_email', e, {
      jobId: job.id,
      brandId
    });
  }
}

// ── plan_posts ───────────────────────────────────────────────────────────────

async function processPlanPosts(
  admin: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: Record<string, any>
): Promise<void> {
  const jobId = job.id as string;
  const input = (job.input ?? {}) as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile?: Record<string, any>;
    platforms?: string[];
    prefs?: ContentPrefs;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plan?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    people?: any;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile: Record<string, any> = { ...(input.profile ?? {}) };
  const platforms: string[] = Array.isArray(input.platforms) ? input.platforms : [];
  const prefs: ContentPrefs = input.prefs && typeof input.prefs === 'object' ? input.prefs : {};
  const plan = normalizePlan(input.plan ?? {}, [...CADENCES]);
  if (Array.isArray(input.people) && input.people.length) profile.people = input.people;

  const userId = job.user_id as string;
  let lastStep = 'start';

  try {
    const posts = await planPreviewPosts(
      profile,
      {
        platforms,
        prefs,
        maxVideos: 1,
        topPosts: [],
        strategyBrief: weekStrategyBrief(plan, 0),
        onProgress: (step, message) => {
          lastStep = step;
          void note(admin, jobId, step, message);
        }
      },
      // Onboarding preview is capped at 3: half the image-render wait before the paywall.
      Math.min(3, postsForWeek(plan, 0))
    );

    // `_i` is a stable index so the follow-up image job patches renders onto the right card.
    const indexed = posts.map((post, i) => ({ ...post, _i: i }));
    const result = { posts: indexed };
    await patchJob(admin, jobId, {
      status: 'done',
      result,
      error: null,
      completed_at: new Date().toISOString(),
      progress: { step: 'captions_ready', message: 'Captions ready' }
    });

    await mirrorDraft(admin, job.draft_id as string | null, userId, {
      previewPosts: indexed,
      planPostsJobId: jobId
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logOnboardingError(admin, userId, 'plan_posts', e, { lastStep, platforms, jobId });
    await failOrRetry(admin, job, message, {
      step: 'error',
      message: 'Post planning failed'
    });
  }
}

// ── preview_images ───────────────────────────────────────────────────────────

async function processPreviewImages(
  admin: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: Record<string, any>
): Promise<void> {
  const jobId = job.id as string;
  const input = (job.input ?? {}) as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile?: Record<string, any>;
    posts?: PreviewPost[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    people?: any;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile: Record<string, any> = { ...(input.profile ?? {}) };
  const posts: PreviewPost[] = Array.isArray(input.posts) ? input.posts : [];
  if (Array.isArray(input.people) && input.people.length) profile.people = input.people;

  const userId = job.user_id as string;
  let lastStep = 'start';
  let rendered = 0;

  // Seed result.posts so partial patches by `_i` have a stable array to merge into.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postsAcc: any[] = posts.map((p, i) => ({ ...p, _i: (p as any)._i ?? i }));
  await patchPartialResult(admin, jobId, { posts: postsAcc });

  // renderPreviewImages fires onPost in parallel — chain DB writes so a late read-modify-write
  // can't clobber an earlier image that already landed in result.posts.
  let writeChain: Promise<void> = Promise.resolve();
  const flushPosts = () => {
    writeChain = writeChain.then(() =>
      patchPartialResult(admin, jobId, { posts: [...postsAcc] })
    );
    return writeChain;
  };

  try {
    // Service-role client: the worker has no user session. Safe only because `brandId` is NOT
    // passed — that would unlock renderPreviewImages' Media-library path, which does its own
    // ownership checks against RLS. Pass brandId here and you must re-check ownership first.
    await renderPreviewImages(profile, posts, {
      supabase: admin,
      userId,
      onProgress: (step, message) => {
        lastStep = step;
        void note(admin, jobId, step, message);
      },
      onPost: (post) => {
        rendered++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const idx = typeof (post as any)._i === 'number' ? (post as any)._i : rendered - 1;
        postsAcc[idx] = { ...postsAcc[idx], ...post, _i: idx };
        void flushPosts();
      }
    });
    await writeChain;

    const result = { posts: postsAcc };
    await patchJob(admin, jobId, {
      status: 'done',
      result,
      error: null,
      completed_at: new Date().toISOString(),
      progress: { step: 'done', message: `Generated ${rendered} images` }
    });

    await mirrorDraft(admin, job.draft_id as string | null, userId, {
      previewPosts: postsAcc,
      previewImagesJobId: jobId
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logOnboardingError(admin, userId, 'preview_images', e, {
      lastStep,
      rendered,
      posts: posts.length,
      jobId
    });
    await failOrRetry(admin, job, message, {
      step: 'error',
      message: 'Image generation failed'
    });
  }
}

/** Run one claimed job to completion. Never throws — failures are recorded on the row. */
export async function processOnboardingStepJob(
  admin: SupabaseClient,
  jobId: string
): Promise<void> {
  try {
    const { data: job } = await admin.from(TABLE).select('*').eq('id', jobId).maybeSingle();
    if (!job) return;

    const kind = job.kind as OnboardingStepKind;
    switch (kind) {
      case 'competitors':
        await processCompetitors(admin, job);
        break;
      case 'research':
        await processResearch(admin, job);
        break;
      case 'plan_posts':
        await processPlanPosts(admin, job);
        break;
      case 'preview_images':
        await processPreviewImages(admin, job);
        break;
      default:
        await patchJob(admin, jobId, {
          status: 'failed',
          error: `Unknown kind: ${String(kind)}`,
          completed_at: new Date().toISOString(),
          progress: { step: 'error', message: 'Unknown job kind' }
        });
    }
  } catch (e) {
    // Outer safety net — processors already catch; this covers unexpected load/dispatch failures.
    console.error('[onboarding-steps] processOnboardingStepJob:', e);
    try {
      await patchJob(admin, jobId, {
        status: 'pending',
        error: (e instanceof Error ? e.message : String(e)).slice(0, 2000),
        started_at: null,
        progress: { step: 'queued', message: 'Retrying…' }
      });
    } catch (error) { swallow('queue step retry', error); }
  }
}
