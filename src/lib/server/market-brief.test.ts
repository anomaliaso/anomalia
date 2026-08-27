import { describe, expect, it } from 'vitest';
import {
  CONTROL_AT,
  EMPTY_BRIEF,
  MIN_BRIEF_COHORT,
  WINNER_AT,
  briefToPrompt,
  median,
  percentileOf,
  positionAgainst,
  type MarketBrief
} from './market-brief';

const post = (over: Partial<MarketBrief['winners'][number]> = {}) => ({
  hook: 'Hai 3 tavoli vuoti il martedì?',
  durationS: 22,
  soundIsOriginal: true,
  outperformance: 2.1,
  topic: 'riempire il martedì',
  url: 'https://x/1',
  ...over
});

const brief = (over: Partial<MarketBrief> = {}): MarketBrief => ({
  ...EMPTY_BRIEF,
  level: 'form',
  contentForm: 'talking_head',
  cohortSize: 42,
  winners: [post()],
  controls: [post({ outperformance: 0.5, hook: 'Buongiorno a tutti' })],
  winnerDurationsS: [10, 20, 30, 40, 50],
  borrowedSoundShare: 0.6,
  ...over
});

describe('percentileOf', () => {
  it('reports the share at or below the value', () => {
    expect(percentileOf(30, [10, 20, 30, 40, 50])).toBe(0.6);
  });

  it('returns null on an empty sample instead of a confident middle', () => {
    // A 0.5 out of nothing reads exactly like a 0.5 out of a thousand rows.
    expect(percentileOf(30, [])).toBeNull();
    expect(percentileOf(30, [NaN])).toBeNull();
  });
});

describe('median', () => {
  it('handles both parities', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('is null on nothing', () => {
    expect(median([])).toBeNull();
  });
});

describe('the winner and control bands', () => {
  it('leave a gap in the middle', () => {
    // Posts hovering at their account's normal carry no signal either way, and including them
    // would blur the contrast the brief exists to show.
    expect(CONTROL_AT).toBeLessThan(WINNER_AT);
    expect(WINNER_AT - CONTROL_AT).toBeGreaterThan(0.3);
  });

  it('gate on a cohort big enough to mean something', () => {
    expect(MIN_BRIEF_COHORT).toBeGreaterThanOrEqual(20);
  });
});

describe('positionAgainst', () => {
  it('places the video in the distribution of what won', () => {
    const p = positionAgainst({ duration_s: 30 }, brief());
    expect(p.durationS).toEqual({ yours: 30, marketMedian: 30, percentile: 0.6 });
    expect(p.notes.join(' ')).toContain('60%');
  });

  it('says nothing at all when the cohort is none', () => {
    // Silence is the correct output of a thin bank. An invented percentile gets believed exactly as
    // much as a real one, which is what makes it worse than an empty block.
    const p = positionAgainst({ duration_s: 30 }, { ...EMPTY_BRIEF });
    expect(p.notes).toEqual([]);
    expect(p.durationS).toBeNull();
    expect(p.borrowedSoundShare).toBeNull();
  });

  it('skips the duration line when the cohort has no durations, and keeps the rest', () => {
    const p = positionAgainst({ duration_s: 30 }, brief({ winnerDurationsS: [] }));
    expect(p.durationS).toBeNull();
    expect(p.notes.join(' ')).toContain('audio');
  });

  it('skips the duration line when the review has no duration', () => {
    expect(positionAgainst({ duration_s: null }, brief()).durationS).toBeNull();
  });

  it('always carries the cohort size and level, so the caller can hedge', () => {
    const p = positionAgainst({ duration_s: 30 }, brief());
    expect(p.cohortSize).toBe(42);
    expect(p.level).toBe('form');
  });
});

describe('briefToPrompt', () => {
  it('gives the planner both sides', () => {
    // A brief of winners alone teaches the average of what became popular — including everything
    // popular content does regardless of whether it caused the popularity.
    const text = briefToPrompt(brief());
    expect(text).toContain('Hanno sovraperformato');
    expect(text).toContain('Non hanno sovraperformato');
    expect(text).toContain('Buongiorno a tutti');
  });

  it('states how much the finding rests on', () => {
    // A model told "here is what works" without being told "this is 42 posts" treats it as law.
    expect(briefToPrompt(brief())).toContain('42 post');
  });

  it('warns when the cohort is only by form', () => {
    expect(briefToPrompt(brief())).toContain('tendenza generale');
  });

  it('drops that warning when the cell is specific', () => {
    const text = briefToPrompt(brief({ level: 'category+form', category: 'food' }));
    expect(text).toContain('food / talking_head');
    expect(text).not.toContain('tendenza generale');
  });

  it('produces nothing at all from an empty cohort', () => {
    expect(briefToPrompt(EMPTY_BRIEF)).toBe('');
  });
});
