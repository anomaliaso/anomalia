import { describe, expect, it } from 'vitest';
import { groupErrors, reasonOf } from './market-errors';
import type { HarvestError } from './market-harvest';

const err = (stage: HarvestError['stage'], target: string, message: string): HarvestError => ({
  stage,
  target,
  message
});

describe('reasonOf', () => {
  it('takes the code in front of the colon', () => {
    expect(reasonOf('too_large: 90000000 > 64000000')).toBe('too_large');
    expect(reasonOf('http_error: 404')).toBe('http_error');
  });

  it('falls back to the first word when there is no code', () => {
    expect(reasonOf('timeout while fetching')).toBe('timeout');
  });

  it('never returns an empty reason', () => {
    expect(reasonOf('')).toBe('unknown');
    expect(reasonOf('   ')).toBe('unknown');
  });

  it('is case-insensitive so one fault does not split into two groups', () => {
    expect(reasonOf('HTTP_ERROR: 500')).toBe(reasonOf('http_error: 500'));
  });
});

describe('groupErrors', () => {
  it('collapses one broken thing into a single group with a count', () => {
    // The point: an hourly cron with one dead endpoint must produce one Sentry event, not 40.
    const errors = Array.from({ length: 40 }, (_, i) =>
      err('discovery', `threads/food: query${i}`, 'http_error: 503')
    );
    const groups = groupErrors(errors);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(40);
    expect(groups[0].reason).toBe('http_error');
  });

  it('keeps distinct faults apart', () => {
    const groups = groupErrors([
      err('media', 'a', 'too_large: 90 > 64'),
      err('media', 'b', 'http_error: 404'),
      err('baseline', 'c', 'too_few_posts (3 < 5)')
    ]);
    expect(groups).toHaveLength(3);
  });

  it('does not merge the same reason across different stages', () => {
    const groups = groupErrors([
      err('media', 'a', 'http_error: 500'),
      err('discovery', 'b', 'http_error: 500')
    ]);
    expect(groups).toHaveLength(2);
  });

  it('ranks the loudest group first', () => {
    const groups = groupErrors([
      err('media', 'a', 'rare: x'),
      ...Array.from({ length: 5 }, (_, i) => err('media', `b${i}`, 'common: y'))
    ]);
    expect(groups[0].reason).toBe('common');
    expect(groups[0].count).toBe(5);
  });

  it('carries a bounded set of samples so the event stays actionable but small', () => {
    const errors = Array.from({ length: 20 }, (_, i) => err('media', `post${i}`, 'too_large: x'));
    const [group] = groupErrors(errors, 3);
    expect(group.samples).toHaveLength(3);
    expect(group.samples[0]).toBe('post0');
  });

  it('returns nothing for no errors', () => {
    expect(groupErrors([])).toEqual([]);
  });
});
