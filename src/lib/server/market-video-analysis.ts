/**
 * Watch the trending clips with Gemini and keep what it saw.
 *
 * This is the part that produces data worth having. A caption scored by regex tells you the text had
 * a question mark in it; a multimodal judge that actually watches the clip tells you WHEN the hook
 * lands, whether it holds without sound, where the reveal sits, whether a CTA ever appears — the
 * things that decide whether short-form video works, none of which are recoverable from the caption.
 *
 * REUSES THE JUDGE WE ALREADY HAVE. `video-review.ts` is a Gemini multimodal reviewer with rubrics
 * distilled from operator doctrine (`video-review-doctrine.ts`), already running in production for
 * our own output QC. Pointing it at market clips costs nothing to build and — more importantly —
 * means our content and the market's are judged by the SAME instrument, which is the only way "how
 * do we compare" is a real question rather than a rhetorical one.
 *
 * COST IS THE REAL CONSTRAINT, and it is not metered here: `reviewVideo` gates credits only inside a
 * brand context, and there is no brand behind a market clip. So the caps in this module are the only
 * thing standing between a cron and an open-ended Gemini bill. They are deliberately small.
 *
 * Judged on the 'organic' standard: these are feed posts competing for attention, not paid ads.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { reviewVideo, type VideoReview } from '$lib/server/video-review';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/**
 * Clips analysed per run. Each is a multimodal Gemini call over a downloaded video — by far the most
 * expensive thing in the whole loop, and the one with no credit gate behind it.
 */
export const MAX_ANALYSES_PER_RUN = 15;

/** Leave room under the function's 300s wall for everything the analysis does not own. */
export const ANALYSIS_TIME_BUDGET_MS = 200_000;

/**
 * A clip must beat its account by this much to count as a WINNER worth spending a judge call on.
 */
export const MIN_OUTPERFORMANCE_TO_ANALYSE = 1.5;

/**
 * …and this much below to count as a CONTROL.
 *
 * Analysing only winners is the survivorship trap this whole design exists to avoid, and the first
 * version of this module walked straight into it. A judge shown nothing but hits learns what hits
 * look like — never what SEPARATES them from the misses of the same account, which is the only
 * question worth asking. "Winners open with a question" is worthless if the flops do too.
 *
 * Controls are drawn from the same accounts as the winners wherever possible, so the comparison
 * holds audience, niche and production budget constant and varies only the content.
 */
export const MAX_OUTPERFORMANCE_FOR_CONTROL = 0.7;

/** Share of each run's budget spent on controls. A third buys a usable contrast without halving the
 *  number of winners seen. */
export const CONTROL_SHARE = 1 / 3;

export type AnalysisResult = {
  analysed: number;
  /** Of which winners — clips that beat their account. */
  winners: number;
  /** Of which controls — clips from the same accounts that did not. Without these the fit is a
   *  description of hits, not a comparison. */
  controls: number;
  failed: number;
  skipped: number;
  errors: Array<{ target: string; message: string }>;
};

/**
 * The fields worth persisting out of a review.
 *
 * Deliberately not the whole blob: what the fit needs are comparable NUMBERS and a few short
 * categorical fields. The full review is kept alongside for reading, but the columns are what gets
 * correlated. Pure — exported for the test.
 */
export function analysisRow(postId: string, review: VideoReview): AnyRec {
  return {
    market_post_id: postId,
    verdict: review.verdict,
    overall: review.overall,
    duration_s: review.duration_s,
    // The hook is the single most predictive thing in short-form, so its parts get their own columns.
    hook_type: review.hook?.type ?? null,
    hook_at_s: review.hook?.at_s ?? null,
    hook_line: review.hook?.line ?? null,
    hook_callout: review.hook?.callout ?? null,
    hook_open_loop: review.hook?.open_loop ?? null,
    scroll_stops: review.doomscroll?.stops ?? null,
    stops_who: review.doomscroll?.who ?? null,
    reveal_at_s: review.reveal_at_s ?? null,
    cta_at_s: review.cta_at_s ?? null,
    dead_seconds: review.dead_seconds ?? [],
    weakest_link: review.weakest_link ?? null,
    // Per-dimension 0..N scores: this is what correlates against outperformance.
    scores: review.scores ?? {},
    spoken: review.script?.spoken ?? null,
    on_screen: review.script?.on_screen ?? null,
    summary: review.summary ?? null,
    review
  };
}

/**
 * Analyse the outperforming clips that have a video and no analysis yet.
 *
 * Ordered by outperformance descending: if the budget runs out, it ran out on the least remarkable
 * clips rather than at random.
 */
/**
 * Pick this run's cohort: the strongest winners, plus controls from the SAME accounts.
 *
 * Drawing controls from the winners' accounts is the point — it holds audience, niche and production
 * budget constant and varies only the content, which is the only way a difference means anything.
 * Where an account has no underperformer in the pool, the slot falls back to any control so the run
 * still has some contrast rather than none.
 *
 * Pure selection over rows already fetched — exported for the test.
 */
export function pickCohort(
  winners: AnyRec[],
  controls: AnyRec[],
  limit: number,
  controlShare = CONTROL_SHARE
): Array<AnyRec & { cohort: 'winner' | 'control' }> {
  const controlSlots = Math.min(controls.length, Math.max(1, Math.round(limit * controlShare)));
  const winnerSlots = Math.max(0, limit - controlSlots);

  const chosenWinners = winners.slice(0, winnerSlots);
  const winnerAccounts = new Set(chosenWinners.map((w) => String(w.account_key ?? '')));

  // Matched first, then anything, so a run is never left with zero contrast.
  const matched = controls.filter((c) => winnerAccounts.has(String(c.account_key ?? '')));
  const rest = controls.filter((c) => !winnerAccounts.has(String(c.account_key ?? '')));
  const chosenControls = [...matched, ...rest].slice(0, controlSlots);

  return [
    ...chosenWinners.map((w) => ({ ...w, cohort: 'winner' as const })),
    ...chosenControls.map((c) => ({ ...c, cohort: 'control' as const }))
  ];
}

const ANALYSIS_COLS =
  'id, platform, account_key, media_url, media_path, content, outperformance';

/**
 * Analyse this run's cohort.
 *
 * Ordered so that if the budget runs out it runs out on the least remarkable clips rather than at
 * random, and always after at least some controls have been seen.
 */
export async function analyseTrendingVideos(
  admin: SupabaseClient,
  opts: { limit?: number; minOutperformance?: number; deadlineMs?: number } = {}
): Promise<AnalysisResult> {
  const limit = opts.limit ?? MAX_ANALYSES_PER_RUN;
  const minOut = opts.minOutperformance ?? MIN_OUTPERFORMANCE_TO_ANALYSE;
  const deadline = opts.deadlineMs ?? Date.now() + ANALYSIS_TIME_BUDGET_MS;

  const [winnersRes, controlsRes] = await Promise.all([
    admin
      .from('market_posts')
      .select(ANALYSIS_COLS)
      .not('media_url', 'is', null)
      .not('outperformance', 'is', null)
      .gte('outperformance', minOut)
      .is('analysed_at', null)
      .order('outperformance', { ascending: false })
      .limit(limit),
    admin
      .from('market_posts')
      .select(ANALYSIS_COLS)
      .not('media_url', 'is', null)
      .not('outperformance', 'is', null)
      .lte('outperformance', MAX_OUTPERFORMANCE_FOR_CONTROL)
      .is('analysed_at', null)
      .order('outperformance', { ascending: true })
      .limit(limit)
  ]);
  if (winnersRes.error) throw new Error(`market winners query failed: ${winnersRes.error.message}`);
  if (controlsRes.error) throw new Error(`market controls query failed: ${controlsRes.error.message}`);

  const cohort = pickCohort((winnersRes.data ?? []) as AnyRec[], (controlsRes.data ?? []) as AnyRec[], limit);
  const result: AnalysisResult = {
    analysed: 0,
    winners: 0,
    controls: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (const row of cohort) {
    if (Date.now() > deadline) {
      result.skipped++;
      continue;
    }
    const url = String(row.media_url ?? '');
    if (!url) {
      result.skipped++;
      continue;
    }

    const review = await reviewVideo(url, {
      standard: 'organic',
      caption: row.content ? String(row.content).slice(0, 2000) : null,
      kind: 'video'
    });

    if (!review.ok) {
      result.failed++;
      result.errors.push({ target: String(row.id), message: review.error.slice(0, 300) });
      // Stamp the attempt so a permanently unfetchable clip is not retried every single run.
      await admin
        .from('market_posts')
        .update({ analysed_at: new Date().toISOString(), analysis_error: review.error.slice(0, 300) })
        .eq('id', row.id);
      continue;
    }

    const { error: insErr } = await admin
      .from('market_video_analyses')
      .upsert({ ...analysisRow(String(row.id), review.review), cohort: row.cohort }, {
        onConflict: 'market_post_id'
      });
    if (insErr) {
      result.failed++;
      result.errors.push({ target: String(row.id), message: insErr.message.slice(0, 300) });
      continue;
    }

    await admin
      .from('market_posts')
      .update({ analysed_at: new Date().toISOString(), analysis_error: null })
      .eq('id', row.id);
    result.analysed++;
    if (row.cohort === 'winner') result.winners++;
    else result.controls++;
  }

  return result;
}
