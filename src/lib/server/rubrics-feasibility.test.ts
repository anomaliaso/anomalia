import { describe, expect, it } from 'vitest';
import {
  checkRubricsAndBatchFeasibility,
  checkRubricsInEditorialPlan,
  rubricNameSet
} from './rubrics-feasibility';
import type { EditorialPlan } from './editorial-plan';
import type { PostSeed } from './content-preview';
import type { Rubric } from './rubrics';

const rubrics: Rubric[] = [
  {
    name: 'Dietro le quinte',
    promise: 'Show the lab',
    strategic_role: 'consideration',
    format: 'carousel',
    cadence: '1/week',
    differentiation: 'insider',
    rationale: 'trust'
  },
  {
    name: 'Tips rapidi',
    promise: 'Actionable tip',
    strategic_role: 'awareness',
    format: 'single_image',
    cadence: '2/week',
    differentiation: 'utility',
    rationale: 'reach'
  }
];

function editorialPlan(weekMix: EditorialPlan['weeks'][0]['content_mix']): EditorialPlan {
  return {
    strategy: 'Test',
    voice: { mood: '', tone: '', goal: '', personality: '' },
    cadence: '3/week',
    platform_mix: [],
    gtm: null,
    weeks: [
      {
        index: 0,
        week_start: null,
        theme: 'T',
        focus: 'F',
        content_mix: weekMix,
        rationale: 'R',
        brief: null,
        products: null,
        status: 'upcoming'
      }
    ]
  };
}

function seed(overrides: Partial<PostSeed>): PostSeed {
  return {
    platform: 'instagram',
    platforms: ['instagram'],
    pillar: 'tips',
    format: 'single_image',
    media: 'image',
    day: 'Mon',
    time: '10:00',
    product: '',
    person: '',
    angle: 'angle',
    subject: 'subject',
    setting: 'studio',
    props: '',
    ...overrides
  };
}

describe('rubrics feasibility', () => {
  it('builds rubric name set', () => {
    expect(rubricNameSet(rubrics)).toEqual(new Set(['dietro le quinte', 'tips rapidi']));
  });

  it('flags editorial plan mix types that are not rubric names', () => {
    const violations = checkRubricsInEditorialPlan(
      editorialPlan([{ type: 'educational', count: 2 }, { type: 'Tips rapidi', count: 1 }]),
      rubrics
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('educational');
  });

  it('passes when content_mix uses only rubric names', () => {
    expect(
      checkRubricsInEditorialPlan(
        editorialPlan([{ type: 'Dietro le quinte', count: 1 }, { type: 'Tips rapidi', count: 2 }]),
        rubrics
      )
    ).toEqual([]);
  });

  it('requires rubric on seeds when brand has approved rubrics', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ rubric: undefined }), seed({ rubric: 'Tips rapidi' })],
      {
        expectedSeedCount: 2,
        selectedPlatforms: ['instagram'],
        products: [],
        people: [],
        mediaIds: new Set(),
        rubrics,
        weekMix: [{ type: 'Tips rapidi', count: 2 }]
      }
    );
    expect(violations.some((v) => v.includes('no rubric'))).toBe(true);
    expect(violations.some((v) => v.includes('Week mix wants'))).toBe(true);
  });

  it('flags wrong format for rubric', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ rubric: 'Dietro le quinte', format: 'single_image' })],
      {
        expectedSeedCount: 1,
        selectedPlatforms: ['instagram'],
        products: [],
        people: [],
        mediaIds: new Set(),
        rubrics
      }
    );
    expect(violations.some((v) => v.includes('requires format carousel'))).toBe(true);
  });

  it('skips week-mix count when plan mix uses legacy labels, not rubric names', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [
        seed({ rubric: 'Un Tap e Via', hook: 'a' }),
        seed({ rubric: 'Tips rapidi', hook: 'b' })
      ],
      {
        expectedSeedCount: 2,
        selectedPlatforms: ['instagram'],
        products: [],
        people: [],
        mediaIds: new Set(),
        rubrics: [
          ...rubrics,
          {
            name: 'Un Tap e Via',
            promise: 'p',
            strategic_role: 'awareness',
            format: 'video',
            cadence: '1/week',
            differentiation: 'd',
            rationale: 'r'
          }
        ],
        weekMix: [
          { type: 'educational', count: 1 },
          { type: 'product', count: 1 }
        ]
      }
    );
    expect(violations.some((v) => v.includes('Week mix wants'))).toBe(false);
  });
});

// Le battute erano una riga di prompt, e una riga di prompt si salta. Qui diventano un vincolo:
// un carosello senza storia torna indietro all'agente prima di costare un render.
describe('carousel beats', () => {
  const ctx = {
    expectedSeedCount: 1,
    selectedPlatforms: ['instagram'],
    products: [],
    people: [],
    mediaIds: new Set<string>(),
    rubrics: [],
    weekMix: []
  };

  it('flags a carousel that arrives without its beats', () => {
    const violations = checkRubricsAndBatchFeasibility([seed({ format: 'carousel', slide_count: 5 })], ctx);
    expect(violations.some((v) => v.includes('beats'))).toBe(true);
  });

  it('flags a beat count that does not match the slides', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ format: 'carousel', slide_count: 5, beats: ['b1', 'b2', 'b3'] })],
      ctx
    );
    expect(violations.some((v) => v.includes('beats'))).toBe(true);
  });

  it('passes a carousel whose beats match its slides', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ format: 'carousel', slide_count: 4, beats: ['b1', 'b2', 'b3', 'b4'] })],
      ctx
    );
    expect(violations).toEqual([]);
  });

  it('never asks a non-carousel seed for beats', () => {
    expect(checkRubricsAndBatchFeasibility([seed({ format: 'single_image' })], ctx)).toEqual([]);
  });
});
