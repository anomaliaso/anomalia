/**
 * Aggregation + comparison for the internal output benchmark. Pure, no I/O, no clock.
 *
 * THE ONLY QUESTION THIS MODULE ANSWERS: "did the thing we changed move the output, or are we
 * reading noise?" That distinction is the whole point — an autopilot's per-post quality is a wide
 * distribution, so a 2-point move in a mean of 40 samples is nothing, and reporting it as a win is
 * how a team convinces itself a bad release was good.
 *
 * So a comparison never returns a bare delta. It returns the delta WITH a 95% confidence interval
 * and an effect size, and `improved` / `regressed` are true only when the interval excludes zero.
 * If you want a single number to look at, look at `verdict`.
 *
 * STATISTICS, HONESTLY. `compareCohorts` is Welch's unequal-variance comparison with a NORMAL
 * approximation for the interval (z = 1.96) instead of a t-distribution. That is mildly
 * anti-conservative below ~30 samples per side, which is why `MIN_COHORT` gates the verdict to
 * `insufficient_data` under 20. We keep the approximation because it needs no stats dependency and
 * the decision it drives — "ship or investigate" — does not turn on the third decimal. Do not quote
 * these intervals as if they came from a pre-registered trial: this is a regression alarm, not a
 * clinical endpoint.
 *
 * WHAT MAKES A COMPARISON VALID. Same `scorer_version` on both sides (a rule change is not a
 * product change) and, for the strong claim, the same brands on both sides — see `pairedByBrand`.
 * Comparing this week's live output to last week's compares brand mixes as much as releases; the
 * frozen golden set exists precisely to remove that confound.
 */

import type { QualityCheckId } from '$lib/server/content-quality';

/** Below this many samples per side a comparison reports `insufficient_data`, never a verdict. */
export const MIN_COHORT = 20;

/** 95% two-sided normal quantile. See the module note on why this is not a t quantile. */
const Z_95 = 1.96;

export type Sample = {
  /** 0..100 index from `scoreContentQuality`. */
  index: number;
  /** Per-check 0..1 values, as stored in `content_quality_samples.checks`. */
  checks?: Record<string, number> | null;
  brandId?: string | null;
  /** Release/commit the content was generated under. */
  release?: string | null;
  scorerVersion?: number | null;
};

export type Summary = {
  n: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  /** Sample standard deviation (n-1). 0 when n < 2. */
  sd: number;
  min: number;
  max: number;
};

export const EMPTY_SUMMARY: Summary = { n: 0, mean: 0, median: 0, p25: 0, p75: 0, sd: 0, min: 0, max: 0 };

const round = (n: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Linear-interpolated quantile on a pre-sorted array. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarize(values: number[]): Summary {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return { ...EMPTY_SUMMARY };
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = n < 2 ? 0 : sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return {
    n,
    mean: round(mean),
    median: round(quantile(sorted, 0.5)),
    p25: round(quantile(sorted, 0.25)),
    p75: round(quantile(sorted, 0.75)),
    sd: round(Math.sqrt(variance)),
    min: round(sorted[0]),
    max: round(sorted[n - 1])
  };
}

export function summarizeSamples(samples: Sample[]): Summary {
  return summarize(samples.map((s) => s.index));
}

export type CheckDelta = {
  id: QualityCheckId | string;
  before: number;
  after: number;
  /** after - before, in 0..1 check units. Positive = improved. */
  delta: number;
};

export type Verdict = 'improved' | 'regressed' | 'flat' | 'insufficient_data' | 'incomparable';

export type Comparison = {
  before: Summary;
  after: Summary;
  /** after.mean - before.mean, in index points. Positive = improved. */
  delta: number;
  /** 95% CI on `delta`. Excludes 0 ⇒ the move survives the noise floor. */
  ci: [number, number];
  /** Cohen's d on the pooled sd. |d| < 0.2 is negligible even when the CI excludes 0. */
  effectSize: number;
  verdict: Verdict;
  /** Per-check movement, biggest absolute mover first — this is what tells you WHAT broke. */
  checks: CheckDelta[];
  /** Set when the verdict is `incomparable` / `insufficient_data`. */
  reason?: string;
};

function meanCheck(samples: Sample[], id: string): number {
  const vals = samples.map((s) => s.checks?.[id]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function checkIds(before: Sample[], after: Sample[]): string[] {
  const ids = new Set<string>();
  for (const s of [...before, ...after]) for (const k of Object.keys(s.checks ?? {})) ids.add(k);
  return [...ids];
}

/** Distinct scorer versions present, so a comparison can refuse to mix rulebooks. */
function versionsOf(samples: Sample[]): Set<number> {
  const out = new Set<number>();
  for (const s of samples) if (typeof s.scorerVersion === 'number') out.add(s.scorerVersion);
  return out;
}

/**
 * Compare two cohorts of samples (typically: before a change vs after it).
 *
 * `before`/`after` naming is directional on purpose — a positive delta always means "the after side
 * is better", whichever cohorts you pass.
 */
export function compareCohorts(before: Sample[], after: Sample[]): Comparison {
  const b = summarizeSamples(before);
  const a = summarizeSamples(after);
  const checks: CheckDelta[] = checkIds(before, after)
    .map((id) => {
      const bv = round(meanCheck(before, id), 3);
      const av = round(meanCheck(after, id), 3);
      return { id, before: bv, after: av, delta: round(av - bv, 3) };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const base = { before: b, after: a, checks };

  // A rule change is not a product change: refuse to read one as the other.
  const versions = new Set([...versionsOf(before), ...versionsOf(after)]);
  if (versions.size > 1) {
    return {
      ...base,
      delta: 0,
      ci: [0, 0],
      effectSize: 0,
      verdict: 'incomparable',
      reason: `scorer_version misti (${[...versions].sort((x, y) => x - y).join(', ')}) — ri-scorare lo storico con la versione corrente prima di confrontare`
    };
  }

  if (b.n < MIN_COHORT || a.n < MIN_COHORT) {
    return {
      ...base,
      delta: round(a.mean - b.mean),
      ci: [0, 0],
      effectSize: 0,
      verdict: 'insufficient_data',
      reason: `servono almeno ${MIN_COHORT} campioni per lato (before ${b.n}, after ${a.n})`
    };
  }

  const delta = a.mean - b.mean;
  // Welch: variances are not assumed equal — cohorts differ in size and spread routinely.
  const se = Math.sqrt(b.sd ** 2 / b.n + a.sd ** 2 / a.n);
  const halfWidth = Z_95 * se;
  const ci: [number, number] = [round(delta - halfWidth), round(delta + halfWidth)];

  const pooledVar = ((b.n - 1) * b.sd ** 2 + (a.n - 1) * a.sd ** 2) / (b.n + a.n - 2);
  const pooledSd = Math.sqrt(pooledVar);
  const effectSize = pooledSd > 0 ? round(delta / pooledSd, 3) : 0;

  // The interval must clear zero. A move that does not is `flat`, however big the point estimate.
  const verdict: Verdict = ci[0] > 0 ? 'improved' : ci[1] < 0 ? 'regressed' : 'flat';

  return { ...base, delta: round(delta), ci, effectSize, verdict };
}

/**
 * Keep only brands present on BOTH sides, so a comparison measures the code and not the brand mix.
 *
 * Live cohorts are the case that needs this: brands churn, onboard and change plan between two
 * releases, and a single high-volume brand with a strong (or broken) voice can swing a fleet mean
 * on its own. Pairing removes that. It costs samples, so `compareCohorts` may then report
 * `insufficient_data` — which is the honest answer, not a reason to drop the pairing.
 */
export function pairedByBrand(before: Sample[], after: Sample[]): { before: Sample[]; after: Sample[] } {
  const brandsBefore = new Set(before.map((s) => s.brandId).filter(Boolean));
  const brandsAfter = new Set(after.map((s) => s.brandId).filter(Boolean));
  const shared = new Set([...brandsBefore].filter((id) => brandsAfter.has(id)));
  return {
    before: before.filter((s) => s.brandId && shared.has(s.brandId)),
    after: after.filter((s) => s.brandId && shared.has(s.brandId))
  };
}

/** Group samples by release tag, newest-first ordering left to the caller. */
export function byRelease(samples: Sample[]): Map<string, Sample[]> {
  const out = new Map<string, Sample[]>();
  for (const s of samples) {
    const key = s.release ?? 'unknown';
    const list = out.get(key);
    if (list) list.push(s);
    else out.set(key, [s]);
  }
  return out;
}

/**
 * Correlation between the index and a real human signal (revisions the user made, 1 if they
 * rejected it, …). This is the benchmark's TRUTH SERUM: a judge that does not predict what humans
 * actually do to the content is measuring itself. Expect a negative correlation — higher index,
 * fewer edits. If it sits near 0, the rubric is wrong and no amount of trend line saves it.
 *
 * Pearson r over the pairs where both values are finite. 0 when fewer than 3 usable pairs.
 */
export function correlateWithHumanSignal(pairs: Array<{ index: number; signal: number }>): { r: number; n: number } {
  const usable = pairs.filter((p) => Number.isFinite(p.index) && Number.isFinite(p.signal));
  const n = usable.length;
  if (n < 3) return { r: 0, n };
  const mx = usable.reduce((s, p) => s + p.index, 0) / n;
  const my = usable.reduce((s, p) => s + p.signal, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const p of usable) {
    const a = p.index - mx;
    const b = p.signal - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return { r: den > 0 ? round(num / den, 3) : 0, n };
}
