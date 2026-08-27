import { describe, expect, it } from 'vitest';
import {
  consumeDraftBudget,
  consumeSearchBudget,
  createStrategyBudget,
  deadlineReached,
  MAX_STRATEGY_DRAFTS,
  MAX_STRATEGY_SEARCHES,
  stallDetected,
  stepFingerprint
} from './strategy-agent';

describe('strategy agent budgets', () => {
  it('rejects search_web beyond the per-run cap at the executor gate', () => {
    const budget = createStrategyBudget({ searches: MAX_STRATEGY_SEARCHES });
    for (let i = 0; i < MAX_STRATEGY_SEARCHES; i++) {
      expect(consumeSearchBudget(budget).ok).toBe(true);
    }
    const blocked = consumeSearchBudget(budget);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/search_web budget exhausted/);
  });

  it('rejects draft_variants beyond the per-run cap at the executor gate', () => {
    const budget = createStrategyBudget({ drafts: MAX_STRATEGY_DRAFTS });
    for (let i = 0; i < MAX_STRATEGY_DRAFTS; i++) {
      expect(consumeDraftBudget(budget).ok).toBe(true);
    }
    const blocked = consumeDraftBudget(budget);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/draft_variants budget exhausted/);
  });

  it('detects stall when fingerprints repeat', () => {
    const fp = '{"cadence":"3/week"}';
    expect(stallDetected([fp, fp, fp, fp], 5)).toBe(false);
    expect(stallDetected([fp, fp, fp, fp, fp], 5)).toBe(true);
  });
});

describe('stall fingerprint', () => {
  // The agent prompts open with a run of free read_* calls. A state-only fingerprint made those
  // steps identical and tripped the stall detector on the exact sequence the prompt asks for.
  it('does not flag a run of different reads as a stall', () => {
    const state = { cadence: undefined, s: 5, d: 2 };
    const reads = ['read_brand_studio', 'read_gtm', 'read_editorial_plan', 'read_knowledge', 'read_media'];
    const fingerprints = reads.map((name) => stepFingerprint(state, [{ toolName: name, input: {} }]));
    expect(stallDetected(fingerprints, 5)).toBe(false);
  });

  it('still flags the same call repeated with the same input', () => {
    const state = { cadence: undefined, s: 5, d: 2 };
    const fingerprints = Array.from({ length: 5 }, () =>
      stepFingerprint(state, [{ toolName: 'read_gtm', input: { brandId: 'b1' } }])
    );
    expect(stallDetected(fingerprints, 5)).toBe(true);
  });

  it('separates the same tool called with different arguments', () => {
    const state = { s: 4, d: 2 };
    const a = stepFingerprint(state, [{ toolName: 'search_web', input: { query: 'competitor cadence' } }]);
    const b = stepFingerprint(state, [{ toolName: 'search_web', input: { query: 'reddit benchmarks' } }]);
    expect(a).not.toBe(b);
  });

  it('survives an unserializable input instead of throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => stepFingerprint({}, [{ toolName: 'draft_variants', input: circular }])).not.toThrow();
  });
});

describe('deadline stop', () => {
  it('fires once the wall-clock budget is spent', () => {
    expect(deadlineReached(Date.now(), 240_000)).toBe(false);
    expect(deadlineReached(Date.now() - 240_001, 240_000)).toBe(true);
  });
});
