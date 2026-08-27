import { describe, expect, it } from 'vitest';
import { checkFeasibility } from './check-feasibility';
import type { EditorialPlan } from './editorial-plan';

const baseCtx = {
  allowedCadences: ['3/week', '5/week'],
  selectedPlatforms: ['instagram', 'reddit'],
  productsWithImages: 2,
  peopleWithImages: 1
};

function plan(overrides: Partial<EditorialPlan>): EditorialPlan {
  return {
    strategy: 'Test',
    voice: { mood: '', tone: '', goal: '', personality: '' },
    cadence: '3/week',
    platform_mix: [{ platform: 'instagram', share: '70%', role: 'discovery' }],
    gtm: null,
    weeks: [
      {
        index: 0,
        week_start: null,
        theme: 'Theme A',
        focus: 'Focus A',
        content_mix: [{ type: 'educational', count: 2 }, { type: 'product', count: 1 }],
        rationale: 'Because',
        brief: null,
        products: null,
        status: 'upcoming'
      },
      {
        index: 1,
        week_start: null,
        theme: 'Theme B',
        focus: 'Focus B',
        content_mix: [{ type: 'educational', count: 3 }],
        rationale: 'Because',
        brief: null,
        products: null,
        status: 'upcoming'
      },
      {
        index: 2,
        week_start: null,
        theme: 'Theme C',
        focus: 'Focus C',
        content_mix: [{ type: 'video', count: 3 }],
        rationale: 'Because',
        brief: null,
        products: null,
        status: 'upcoming'
      },
      {
        index: 3,
        week_start: null,
        theme: 'Theme D',
        focus: 'Focus D',
        content_mix: [{ type: 'social proof', count: 3 }],
        rationale: 'Because',
        brief: null,
        products: null,
        status: 'upcoming'
      }
    ],
    ...overrides
  };
}

describe('checkFeasibility', () => {
  it('passes a valid plan', () => {
    expect(checkFeasibility(plan({}), baseCtx)).toEqual([]);
  });

  it('flags cadence outside tier', () => {
    const v = checkFeasibility(plan({ cadence: 'daily' }), baseCtx);
    expect(v.some((x) => x.includes('Cadence "daily"'))).toBe(true);
  });

  it('flags content_mix that does not sum to cadence', () => {
    const bad = plan({});
    bad.weeks[0].content_mix = [{ type: 'educational', count: 4 }];
    const v = checkFeasibility(bad, baseCtx);
    expect(v.some((x) => x.includes('content_mix sums to 4'))).toBe(true);
  });

  it('flags 4 carousels with only 2 photographed products', () => {
    const bad = plan({});
    bad.weeks[0].content_mix = [{ type: 'carousel', count: 4 }];
    const v = checkFeasibility(bad, { ...baseCtx, productsWithImages: 2 });
    expect(v.some((x) => x.includes('4 product-heavy') && x.includes('2 photographed'))).toBe(true);
  });

  it('flags empty theme', () => {
    const bad = plan({});
    bad.weeks[1].theme = '';
    expect(checkFeasibility(bad, baseCtx).some((x) => x.includes('theme is empty'))).toBe(true);
  });

  it('flags content_mix types that are not approved rubrics', () => {
    const rubrics = [
      {
        name: 'Serie A',
        promise: '',
        strategic_role: '',
        format: 'single_image' as const,
        cadence: '',
        differentiation: '',
        rationale: ''
      }
    ];
    const bad = plan({});
    bad.weeks[0].content_mix = [{ type: 'educational', count: 3 }];
    const v = checkFeasibility(bad, { ...baseCtx, approvedRubrics: rubrics });
    expect(v.some((x) => x.includes('not an approved rubric'))).toBe(true);
  });
});
