/**
 * Persistence + the continuous measurement loop for the internal output benchmark.
 *
 * Scoring is pure (`content-quality.ts`) and comparison is pure (`benchmark.ts`); everything that
 * touches Supabase lives here. The cron at `/api/v1/benchmark/tick` calls `runBenchmarkTick`.
 *
 * WHAT GETS SAMPLED. Posts that reached a committed state (approved / scheduled / published) — not
 * drafts. A draft the user threw away was never our output, and including drafts lets a brand that
 * regenerates a lot drag the fleet index around for reasons that have nothing to do with quality.
 *
 * COST. Zero AI. The whole tick is two selects and one insert per batch, which is why this can run
 * every 30 minutes over the whole fleet and why the back-catalogue can be re-scored from scratch
 * whenever the rulebook changes (`rescoreBacklog`). That property is the reason the spine is
 * deterministic — see the header of `content-quality.ts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONTENT_SCORER_VERSION,
  checkValues,
  scoreContentQuality
} from '$lib/server/content-quality';
import { summarize, type Sample } from '$lib/server/benchmark';
import { releaseTag } from '$lib/server/release-tag';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Statuses that mean the brand committed to this content. Drafts are not our output yet. */
export const SAMPLED_STATUSES = ['approved', 'scheduled', 'published'] as const;

/** Posts scored per tick. Deterministic scoring is microseconds; the cap is for the DB round-trips. */
export const BENCHMARK_BATCH = 200;

/** How many of a brand's earlier captions each post is compared against for self-repetition. */
export const REPETITION_WINDOW = 15;

/**
 * The build that generated the content, as `<semver>+<commit>`.
 * The definition lives in `src/lib/server/release-tag.ts`, shared with
 * `/api/v1/version` — one place, so the two cannot drift.
 */

export type PostRow = {
  id: string;
  brand_id: string;
  platform: string | null;
  caption: string | null;
  status: string | null;
  revisions_count: number | null;
  created_at: string;
};

export type TickResult = {
  scored: number;
  skipped: number;
  /** Candidates left unscored because the batch cap was hit — the cron will pick them up next run. */
  remaining: number;
};

/**
 * Captions the post should be compared against for self-repetition: the same brand's earlier
 * committed posts, oldest-of-the-window first. Only posts created BEFORE the one being scored count
 * — comparing a post against its own future would make the score depend on when the tick ran, and
 * a benchmark whose numbers move on re-run is not a benchmark.
 */
export function repetitionPeers(post: PostRow, brandPosts: PostRow[], window = REPETITION_WINDOW): string[] {
  return brandPosts
    .filter((p) => p.id !== post.id && p.created_at < post.created_at)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, window)
    .map((p) => String(p.caption ?? ''))
    .filter((c) => c.trim().length > 0);
}

/** Build the row to insert. Exported for the unit test — no I/O. */
export function sampleRowFor(
  post: PostRow,
  peers: string[],
  opts: { release: string; runId?: string | null }
): AnyRec {
  const quality = scoreContentQuality({
    caption: post.caption,
    platform: post.platform,
    recentCaptions: peers
  });
  return {
    brand_id: post.brand_id,
    post_id: post.id,
    platform: post.platform,
    release: opts.release,
    scorer_version: CONTENT_SCORER_VERSION,
    run_id: opts.runId ?? null,
    quality_index: quality.index,
    checks: checkValues(quality),
    metrics: quality.metrics,
    revisions_count: post.revisions_count ?? 0,
    post_status: post.status,
    content_created_at: post.created_at
  };
}

/**
 * Score every committed post that has no sample at the current scorer version.
 *
 * Idempotent: the unique (post_id, scorer_version) index makes a repeated tick a no-op, so an
 * overlapping cron cannot double-count and skew the fleet mean.
 */
export async function runBenchmarkTick(
  admin: SupabaseClient,
  opts: { brandId?: string; sinceDays?: number; limit?: number; runId?: string | null } = {}
): Promise<TickResult> {
  const limit = opts.limit ?? BENCHMARK_BATCH;
  const release = releaseTag();

  // Candidate window. Default 30 days keeps the tick cheap; `rescoreBacklog` handles history.
  const since = new Date(Date.now() - (opts.sinceDays ?? 30) * 86_400_000).toISOString();

  let candidateQuery = admin
    .from('posts')
    .select('id, brand_id, platform, caption, status, revisions_count, created_at')
    .in('status', SAMPLED_STATUSES as unknown as string[])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit * 3);
  if (opts.brandId) candidateQuery = candidateQuery.eq('brand_id', opts.brandId);

  const { data: candidates, error: candErr } = await candidateQuery;
  if (candErr) throw new Error(`benchmark candidates query failed: ${candErr.message}`);
  const posts = (candidates ?? []) as PostRow[];
  if (!posts.length) return { scored: 0, skipped: 0, remaining: 0 };

  // Which of these are already scored under the current rulebook.
  const { data: existing, error: exErr } = await admin
    .from('content_quality_samples')
    .select('post_id')
    .eq('scorer_version', CONTENT_SCORER_VERSION)
    .in('post_id', posts.map((p) => p.id));
  if (exErr) throw new Error(`benchmark existing query failed: ${exErr.message}`);
  const done = new Set((existing ?? []).map((r: AnyRec) => String(r.post_id)));

  const todo = posts.filter((p) => !done.has(p.id));
  const batch = todo.slice(0, limit);
  if (!batch.length) return { scored: 0, skipped: posts.length, remaining: 0 };

  // Self-repetition needs each brand's earlier captions. One query per brand in the batch, not one
  // per post — a brand publishing daily would otherwise cost a query per post.
  const brandIds = [...new Set(batch.map((p) => p.brand_id))];
  const peersByBrand = new Map<string, PostRow[]>();
  for (const brandId of brandIds) {
    const { data, error } = await admin
      .from('posts')
      .select('id, brand_id, platform, caption, status, revisions_count, created_at')
      .eq('brand_id', brandId)
      .in('status', SAMPLED_STATUSES as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(REPETITION_WINDOW * 4);
    if (error) throw new Error(`benchmark peers query failed: ${error.message}`);
    peersByBrand.set(brandId, (data ?? []) as PostRow[]);
  }

  const rows = batch.map((post) =>
    sampleRowFor(post, repetitionPeers(post, peersByBrand.get(post.brand_id) ?? []), {
      release,
      runId: opts.runId
    })
  );

  // Ignore duplicates rather than fail the tick: a concurrent run may have inserted some of these.
  const { error: insErr } = await admin
    .from('content_quality_samples')
    .upsert(rows, { onConflict: 'post_id,scorer_version', ignoreDuplicates: true });
  if (insErr) throw new Error(`benchmark insert failed: ${insErr.message}`);

  return {
    scored: rows.length,
    skipped: posts.length - todo.length,
    remaining: Math.max(0, todo.length - batch.length)
  };
}

export type SampleFilter = {
  scorerVersion?: number;
  release?: string;
  brandId?: string;
  runId?: string;
  since?: string;
  until?: string;
  limit?: number;
};

/** Read samples back in the shape `benchmark.ts` compares. */
export async function loadSamples(admin: SupabaseClient, filter: SampleFilter = {}): Promise<Sample[]> {
  let query = admin
    .from('content_quality_samples')
    .select('brand_id, release, scorer_version, quality_index, checks, revisions_count, post_status, content_created_at')
    .eq('scorer_version', filter.scorerVersion ?? CONTENT_SCORER_VERSION)
    .order('content_created_at', { ascending: false })
    .limit(filter.limit ?? 5000);
  if (filter.release) query = query.eq('release', filter.release);
  if (filter.brandId) query = query.eq('brand_id', filter.brandId);
  if (filter.runId) query = query.eq('run_id', filter.runId);
  if (filter.since) query = query.gte('content_created_at', filter.since);
  if (filter.until) query = query.lt('content_created_at', filter.until);

  const { data, error } = await query;
  if (error) throw new Error(`benchmark samples query failed: ${error.message}`);
  return (data ?? []).map((r: AnyRec) => ({
    index: Number(r.quality_index),
    checks: (r.checks ?? {}) as Record<string, number>,
    brandId: r.brand_id ? String(r.brand_id) : null,
    release: r.release ? String(r.release) : null,
    scorerVersion: Number(r.scorer_version)
  }));
}

/**
 * Index vs the user's own behaviour. `revisions_count` is free labelled data: the user regenerating
 * a post is them telling us the output was not good enough. If the correlation is not clearly
 * negative, the rubric — not the product — is what needs fixing.
 */
export async function loadHumanSignalPairs(
  admin: SupabaseClient,
  opts: { scorerVersion?: number; limit?: number } = {}
): Promise<Array<{ index: number; signal: number }>> {
  const { data, error } = await admin
    .from('content_quality_samples')
    .select('quality_index, revisions_count')
    .eq('scorer_version', opts.scorerVersion ?? CONTENT_SCORER_VERSION)
    .not('revisions_count', 'is', null)
    .order('sampled_at', { ascending: false })
    .limit(opts.limit ?? 5000);
  if (error) throw new Error(`benchmark human-signal query failed: ${error.message}`);
  return (data ?? []).map((r: AnyRec) => ({
    index: Number(r.quality_index),
    signal: Number(r.revisions_count)
  }));
}

/**
 * Re-score history under the CURRENT rulebook after a `CONTENT_SCORER_VERSION` bump.
 *
 * This is what keeps a rule change from looking like a product change: comparisons refuse to mix
 * versions (see `compareCohorts`), so after a bump the old cohort must be re-scored before any
 * before/after is meaningful. Cheap enough to run over everything because scoring is pure.
 * Returns the number of samples written.
 */
export async function rescoreBacklog(
  admin: SupabaseClient,
  opts: { sinceDays?: number; maxBatches?: number } = {}
): Promise<{ written: number; batches: number }> {
  const maxBatches = opts.maxBatches ?? 25;
  let written = 0;
  let batches = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await runBenchmarkTick(admin, { sinceDays: opts.sinceDays ?? 365 });
    written += res.scored;
    batches++;
    if (res.scored === 0 || res.remaining === 0) break;
  }
  return { written, batches };
}

export type GoldenCandidate = {
  caption: string;
  platform?: string | null;
  /** Real brand the candidate was generated for — its recent posts become the repetition baseline. */
  brandId?: string | null;
  /** Overrides the repetition baseline. Pass `[]` to disable the check for this candidate. */
  recentCaptions?: string[];
};

/**
 * Score a batch of freshly generated candidates as one named GOLDEN run.
 *
 * This is the instrument for "did this change help?", and it is the one that works TODAY. The live
 * stream needs volume the fleet does not yet produce — with a few hundred committed posts in total,
 * splitting them around a deploy leaves cohorts too small for a verdict (see MIN_COHORT). A golden
 * run sidesteps that: regenerate the SAME frozen briefs before and after the change and the only
 * thing that differs between the two cohorts is our code. Brand mix, season and luck are held
 * constant by construction, which is exactly what the live comparison cannot promise.
 *
 * The repetition baseline is pulled from the brand's real recent posts, so a golden score means the
 * same thing a live score does and the two are comparable.
 */
export async function scoreGoldenRun(
  admin: SupabaseClient,
  input: { label: string; notes?: string | null; candidates: GoldenCandidate[] }
): Promise<{ runId: string | null; scored: number }> {
  const candidates = input.candidates.filter((c) => typeof c?.caption === 'string');
  if (!candidates.length) return { runId: null, scored: 0 };

  // One peer lookup per distinct brand, only for candidates that did not bring their own baseline.
  const brandIds = [
    ...new Set(candidates.filter((c) => c.brandId && !c.recentCaptions).map((c) => String(c.brandId)))
  ];
  const peersByBrand = new Map<string, string[]>();
  for (const brandId of brandIds) {
    const { data, error } = await admin
      .from('posts')
      .select('caption')
      .eq('brand_id', brandId)
      .in('status', SAMPLED_STATUSES as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(REPETITION_WINDOW);
    if (error) throw new Error(`benchmark golden peers query failed: ${error.message}`);
    peersByBrand.set(
      brandId,
      (data ?? []).map((r: AnyRec) => String(r.caption ?? '')).filter((c) => c.trim().length > 0)
    );
  }

  const release = releaseTag();
  const scored = candidates.map((c) => {
    const peers = c.recentCaptions ?? (c.brandId ? (peersByBrand.get(String(c.brandId)) ?? []) : []);
    const quality = scoreContentQuality({
      caption: c.caption,
      platform: c.platform,
      recentCaptions: peers
    });
    return { candidate: c, quality };
  });

  const runId = await recordRun(admin, {
    kind: 'golden',
    label: input.label,
    notes: input.notes ?? null,
    stats: summarize(scored.map((s) => s.quality.index)) as unknown as AnyRec
  });
  if (!runId) throw new Error('benchmark golden run could not be recorded');

  const rows = scored.map(({ candidate, quality }) => ({
    brand_id: candidate.brandId ?? null,
    post_id: null,
    platform: candidate.platform ?? null,
    release,
    scorer_version: CONTENT_SCORER_VERSION,
    run_id: runId,
    quality_index: quality.index,
    checks: checkValues(quality),
    metrics: quality.metrics,
    revisions_count: null,
    post_status: null,
    content_created_at: new Date().toISOString()
  }));

  const { error } = await admin.from('content_quality_samples').insert(rows);
  if (error) throw new Error(`benchmark golden insert failed: ${error.message}`);
  return { runId, scored: rows.length };
}

/** Record a named run (used by the golden-set harness and for annotating a release boundary). */
export async function recordRun(
  admin: SupabaseClient,
  run: { kind?: 'live' | 'golden'; label: string; notes?: string | null; stats?: AnyRec | null }
): Promise<string | null> {
  const { data, error } = await admin
    .from('benchmark_runs')
    .insert({
      kind: run.kind ?? 'live',
      label: run.label,
      release: releaseTag(),
      scorer_version: CONTENT_SCORER_VERSION,
      notes: run.notes ?? null,
      stats: run.stats ?? null
    })
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[benchmark] recordRun failed:', error.message);
    return null;
  }
  return data?.id ? String(data.id) : null;
}
