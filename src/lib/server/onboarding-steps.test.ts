import { describe, expect, it } from 'vitest';
import { putStep, resumableStudy } from './onboarding-steps';

const study = () => ({
  report: { headline: 'white space is short-form teardown' },
  buyerPersonas: [{ name: 'Ops lead' }],
  researchData: { competitors: [], report: {}, benchmark: {}, positioning: '', personas: [] },
  planInputs: { aiContext: 'brand context', visualStyle: null, topPosts: [], zeroToOne: true }
});

describe('resumableStudy', () => {
  it('hands back the market study a killed attempt already paid for', () => {
    const saved = study();

    expect(resumableStudy(saved)).toEqual({
      report: saved.report,
      buyerPersonas: saved.buyerPersonas,
      researchData: saved.researchData,
      planInputs: saved.planInputs
    });
  });

  it('re-runs the study when the attempt died before it was whole', () => {
    const { planInputs, ...halfway } = study();

    expect(resumableStudy(halfway)).toBeNull();
    expect(resumableStudy({ ...study(), researchData: null })).toBeNull();
    expect(resumableStudy({ steps: [] })).toBeNull();
    expect(resumableStudy(null)).toBeNull();
  });
});

describe('putStep', () => {
  it('does not repeat a step a resumed attempt already earned', () => {
    const earned = ['handles', 'scraping', 'benchmark', 'analysis', 'strategy', 'editorialPlan'].map(
      (step) => ({ step, message: `${step} done` })
    );

    const timeline = putStep(earned, { step: 'editorialPlan', message: 'Drafting your editorial plan…' });

    expect(timeline.map((s) => s.step)).toEqual([
      'handles',
      'scraping',
      'benchmark',
      'analysis',
      'strategy',
      'editorialPlan'
    ]);
    expect(timeline.at(-1)?.message).toBe('Drafting your editorial plan…');
  });

  it('keeps the result the step already carried when only the message moves on', () => {
    const earned = [{ step: 'benchmark', message: 'Comparing…', result: { medianEngagement: 42 } }];

    expect(putStep(earned, { step: 'benchmark', message: 'Compared' })).toEqual([
      { step: 'benchmark', message: 'Compared', result: { medianEngagement: 42 } }
    ]);
  });

  it('appends a step the timeline has never seen', () => {
    expect(putStep([{ step: 'handles', message: 'Finding…' }], { step: 'scraping', message: 'Reading…' })).toEqual([
      { step: 'handles', message: 'Finding…' },
      { step: 'scraping', message: 'Reading…' }
    ]);
  });
});
