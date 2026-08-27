import { describe, expect, it } from 'vitest';
import { SCRAPECREATORS_TIMEOUT_MS } from './scrapecreators';
import { BASELINE_TIME_BUDGET_MS } from './market-harvest';

describe('SCRAPECREATORS_TIMEOUT_MS', () => {
  it('exists at all — Node fetch has no default, so without it a stalled socket hangs forever', () => {
    // Measured in production: two hashtag searches hung 43.7 minutes before failing. The trend
    // sweep aggregates with Promise.all, so those two took whole runs down with them — the function
    // hit its wall with nothing written and no error row, because the code that records those never
    // got to run.
    expect(SCRAPECREATORS_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(SCRAPECREATORS_TIMEOUT_MS)).toBe(true);
  });

  it('leaves room for the slowest legitimate response instead of cutting it off', () => {
    // The slowest real answers observed are LinkedIn 404s at ~46s. A timeout under that would turn
    // a working endpoint into a flaky one, which is a worse failure than the one being fixed.
    expect(SCRAPECREATORS_TIMEOUT_MS).toBeGreaterThanOrEqual(50_000);
  });

  it('cannot swallow a whole fetching budget on one call', () => {
    // The point of a bound is that a single bad socket costs one slot, not the run. If one call
    // could eat the baseline budget, the queue would stall exactly as it did before.
    expect(SCRAPECREATORS_TIMEOUT_MS * 2).toBeLessThan(BASELINE_TIME_BUDGET_MS);
  });
});
