import { describe, expect, it } from 'vitest';
import { resumableStudy } from './onboarding-steps';

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
