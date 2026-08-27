import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_TIME_BUDGET_MS,
  MAX_ANALYSES_PER_RUN,
  MAX_OUTPERFORMANCE_FOR_CONTROL,
  MIN_OUTPERFORMANCE_TO_ANALYSE,
  analysisRow,
  pickCohort
} from './market-video-analysis';
import type { VideoReview } from './video-review';

const review = (over: Partial<VideoReview> = {}): VideoReview =>
  ({
    standard: 'organic',
    verdict: 'ship',
    overall: 82,
    duration_s: 19,
    doomscroll: { stops: true, who: 'ristoratori con tavoli vuoti infrasettimanali', reason: 'nomina il problema' },
    hook: {
      at_s: 0.4,
      type: 'pain_callout',
      line: 'Hai 3 tavoli vuoti il martedì?',
      visual: 'sala vuota',
      callout: true,
      open_loop: true,
      promise_match: true,
      unique: true
    },
    reveal_at_s: 9,
    cta_at_s: 17,
    dead_seconds: [6, 7],
    scores: { scroll_stop: 9, hold: 7, sound_off: 8 },
    weakest_link: 'hold',
    issues: [],
    next_test: '',
    summary: 'apre sul problema, rivela a metà',
    script: { spoken: 'testo parlato', on_screen: 'testo a schermo', caption: 'caption' },
    judgment: 'buono',
    ...over
  }) as VideoReview;

describe('analysisRow', () => {
  it('lifts the hook into its own columns — nothing can group by a field inside jsonb', () => {
    const row = analysisRow('post-1', review());
    expect(row.hook_type).toBe('pain_callout');
    expect(row.hook_at_s).toBe(0.4);
    expect(row.hook_callout).toBe(true);
    expect(row.hook_open_loop).toBe(true);
  });

  it('keeps the timings the caption could never give', () => {
    const row = analysisRow('post-1', review());
    expect(row.reveal_at_s).toBe(9);
    expect(row.cta_at_s).toBe(17);
    expect(row.dead_seconds).toEqual([6, 7]);
  });

  it('keeps the per-dimension scores, which are what the fit correlates', () => {
    expect(analysisRow('post-1', review()).scores).toEqual({ scroll_stop: 9, hold: 7, sound_off: 8 });
  });

  it('keeps what was said AND what was written on screen — two different failures', () => {
    const row = analysisRow('post-1', review());
    expect(row.spoken).toBe('testo parlato');
    expect(row.on_screen).toBe('testo a schermo');
  });

  it('keeps the full review alongside the columns', () => {
    expect(analysisRow('post-1', review()).review).toBeTruthy();
  });

  it('survives a review missing its optional parts rather than throwing', () => {
    const partial = analysisRow('post-1', {
      standard: 'organic',
      verdict: 'fix',
      overall: 40
    } as VideoReview);
    expect(partial.hook_type).toBeNull();
    expect(partial.reveal_at_s).toBeNull();
    expect(partial.dead_seconds).toEqual([]);
    expect(partial.scores).toEqual({});
  });

  it('carries the post id it belongs to', () => {
    expect(analysisRow('post-42', review()).market_post_id).toBe('post-42');
  });
});

describe('analysis budget', () => {
  it('is capped tightly — there is no credit gate behind a market clip', () => {
    // reviewVideo only gates credits inside a brand context, and a market clip has no brand. These
    // caps are the only thing between a cron and an open-ended Gemini bill.
    expect(MAX_ANALYSES_PER_RUN).toBeLessThanOrEqual(25);
    expect(ANALYSIS_TIME_BUDGET_MS).toBeLessThan(300_000);
  });

  it('only spends on clips that actually beat their own account', () => {
    // Judging an average post teaches nothing we could not guess; flops are already covered free by
    // the deterministic scorer.
    expect(MIN_OUTPERFORMANCE_TO_ANALYSE).toBeGreaterThan(1);
  });
});

describe('pickCohort', () => {
  const post = (id: string, account: string, out: number) => ({
    id,
    account_key: account,
    outperformance: out,
    media_url: 'https://cdn/v.mp4'
  });

  it('always includes controls — a judge shown only hits learns what hits look like', () => {
    const winners = Array.from({ length: 20 }, (_, i) => post(`w${i}`, `acct${i}`, 3));
    const controls = Array.from({ length: 20 }, (_, i) => post(`c${i}`, `acct${i}`, 0.4));
    const cohort = pickCohort(winners, controls, 15);
    expect(cohort.filter((c) => c.cohort === 'control').length).toBeGreaterThan(0);
    expect(cohort.filter((c) => c.cohort === 'winner').length).toBeGreaterThan(0);
    expect(cohort).toHaveLength(15);
  });

  it('prefers controls from the SAME accounts as the winners', () => {
    // Holding audience, niche and production budget constant is what makes a difference mean
    // something; an unmatched control varies everything at once.
    const winners = [post('w1', 'chef', 4)];
    const controls = [post('c-other', 'stranger', 0.3), post('c-same', 'chef', 0.3)];
    const cohort = pickCohort(winners, controls, 2, 0.5);
    expect(cohort.find((c) => c.cohort === 'control')?.id).toBe('c-same');
  });

  it('falls back to any control rather than leaving a run with no contrast', () => {
    const cohort = pickCohort([post('w1', 'chef', 4)], [post('c1', 'stranger', 0.2)], 2, 0.5);
    expect(cohort.filter((c) => c.cohort === 'control')).toHaveLength(1);
  });

  it('spends most of the budget on winners', () => {
    const winners = Array.from({ length: 30 }, (_, i) => post(`w${i}`, `a${i}`, 3));
    const controls = Array.from({ length: 30 }, (_, i) => post(`c${i}`, `a${i}`, 0.4));
    const cohort = pickCohort(winners, controls, 15);
    expect(cohort.filter((c) => c.cohort === 'winner').length).toBeGreaterThan(
      cohort.filter((c) => c.cohort === 'control').length
    );
  });

  it('copes with an empty side', () => {
    expect(pickCohort([], [], 10)).toEqual([]);
    expect(pickCohort([post('w', 'a', 3)], [], 10).every((c) => c.cohort === 'winner')).toBe(true);
  });

  it('never exceeds the run budget', () => {
    const many = Array.from({ length: 100 }, (_, i) => post(`x${i}`, `a${i}`, 3));
    expect(pickCohort(many, many, 15)).toHaveLength(15);
  });
});

describe('control threshold', () => {
  it('sits clearly below typical, so a control really is an underperformer', () => {
    expect(MAX_OUTPERFORMANCE_FOR_CONTROL).toBeLessThan(1);
    expect(MAX_OUTPERFORMANCE_FOR_CONTROL).toBeLessThan(MIN_OUTPERFORMANCE_TO_ANALYSE);
  });
});
