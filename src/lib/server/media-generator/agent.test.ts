import { describe, expect, it } from 'vitest';
import { buildSystem, mediaGeneratorBudget } from './agent';

describe('mediaGeneratorBudget', () => {
  it('without refs equals the variants setting', () => {
    expect(mediaGeneratorBudget({ kind: 'image', variants: 1, refCount: 0 })).toEqual({
      images: 1,
      videos: 0
    });
    expect(mediaGeneratorBudget({ kind: 'image', variants: 4, refCount: 0 })).toEqual({
      images: 4,
      videos: 0
    });
  });

  it('with refs allows variants × refs so multi-edit fits (ceiling, not quota)', () => {
    // Case A: edit all 4 refs, variants=1 → room for 4
    expect(mediaGeneratorBudget({ kind: 'image', variants: 1, refCount: 4 })).toEqual({
      images: 4,
      videos: 0
    });
    // Case A: edit all 4 refs, variants=4 → room for 16
    expect(mediaGeneratorBudget({ kind: 'image', variants: 4, refCount: 4 })).toEqual({
      images: 16,
      videos: 0
    });
  });

  it('does not imply refs always multiply when agent chooses Case B — budget is only a ceiling', () => {
    // Agent may still produce only `variants` totals; budget just must not block Case A.
    const b = mediaGeneratorBudget({ kind: 'image', variants: 2, refCount: 3 });
    expect(b.images).toBe(6);
    expect(b.images).toBeGreaterThanOrEqual(2);
  });

  it('video kind scales both still and clip budgets; image kind disables video', () => {
    expect(mediaGeneratorBudget({ kind: 'video', variants: 2, refCount: 3 })).toEqual({
      images: 6,
      videos: 6
    });
    expect(mediaGeneratorBudget({ kind: 'image', variants: 2, refCount: 3 }).videos).toBe(0);
  });

  it('clamps absurd inputs', () => {
    expect(mediaGeneratorBudget({ kind: 'auto', variants: 99, refCount: 99 }).images).toBe(16);
    expect(mediaGeneratorBudget({ kind: 'auto', variants: 0, refCount: 2 }).images).toBe(2);
  });
});

describe('buildSystem UGC QC', () => {
  it('requires auto-review and a remake when the score is low', () => {
    const system = buildSystem({
      aspect: '9:16',
      kind: 'video',
      variants: 1,
      useBrandStyle: true,
      forceUgc: true,
      refCount: 0,
      imageBudget: 1,
      videoBudget: 1
    });
    expect(system).toMatch(/auto-reviews/i);
    expect(system).not.toMatch(/do not auto-review/);
    expect(system).toMatch(/fix\/kill|below 7/);
  });
});
