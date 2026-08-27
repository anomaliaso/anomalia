import { describe, expect, it } from 'vitest';
import {
  assessEvidence,
  confidenceLabel,
  evidenceBlock,
  levelOf,
  rankingIsSafe,
  requiredSamplePerArm,
  sampleVerdict
} from './evidence-quality';

describe('sampleVerdict', () => {
  it('calls ten observations noise', () => {
    expect(sampleVerdict(3)).toBe('insufficient');
    expect(sampleVerdict(9)).toBe('insufficient');
  });

  it('calls fifty directional', () => {
    expect(sampleVerdict(10)).toBe('directional');
    expect(sampleVerdict(49)).toBe('directional');
  });

  it('accepts real volume', () => {
    expect(sampleVerdict(50)).toBe('usable');
    expect(sampleVerdict(4000)).toBe('usable');
  });
});

describe('rankingIsSafe', () => {
  it('refuses to rank five options on a week of posts', () => {
    expect(rankingIsSafe(12, 5)).toBe(false);
  });

  it('allows a ranking when each option carries real volume', () => {
    expect(rankingIsSafe(400, 5)).toBe(true);
  });

  it('is trivially true when there is nothing to rank', () => {
    expect(rankingIsSafe(3, 1)).toBe(true);
  });
});

describe('levelOf', () => {
  it('orders the hierarchy strongest to weakest', () => {
    expect(levelOf('experiment')).toBe(1);
    expect(levelOf('trend')).toBe(4);
    expect(levelOf('vibes')).toBe(6);
  });
});

describe('assessEvidence', () => {
  it('refuses to act on noise, whatever the design', () => {
    const r = assessEvidence({ design: 'experiment', sample: 6, unit: 'conversioni', reversible: true });
    expect(r.sampleVerdict).toBe('insufficient');
    expect(r.safeToAct).toBe(false);
    expect(r.cannotSupport).toContain('vince');
  });

  it('lets a directional read ship a reversible change but not an irreversible one', () => {
    const reversible = assessEvidence({ design: 'trend', sample: 20, unit: 'post', reversible: true });
    const irreversible = assessEvidence({ design: 'trend', sample: 20, unit: 'post', reversible: false });
    expect(reversible.safeToAct).toBe(true);
    expect(irreversible.safeToAct).toBe(false);
  });

  it('blocks an irreversible decision on a trend even at real volume', () => {
    // Level 4 is "they moved together"; a pricing change needs better than that at any n.
    const r = assessEvidence({ design: 'trend', sample: 5000, unit: 'sessioni', reversible: false });
    expect(r.safeToAct).toBe(false);
    expect(r.cannotSupport).toContain('causale');
  });

  it('flags a leaderboard built on a handful of posts', () => {
    const r = assessEvidence({ design: 'trend', sample: 12, unit: 'post', rankedItems: 5 });
    expect(r.traps.map((t) => t.id)).toContain('ranking_on_noise');
    expect(r.traps.find((t) => t.id === 'ranking_on_noise')!.note).toContain('rumore');
  });

  it('names every trap it was told about', () => {
    const r = assessEvidence({
      design: 'cohort',
      sample: 200,
      unit: 'conversioni',
      peeked: true,
      survivorsOnly: true,
      wasPreviousBest: true,
      segmentsDisagree: true,
      measurementChanged: true,
      unlikePeriods: true,
      vanityMetric: true,
      improbableImprovement: true
    });
    const ids = r.traps.map((t) => t.id);
    expect(ids).toContain('peeking');
    expect(ids).toContain('survivorship');
    expect(ids).toContain('regression_to_mean');
    expect(ids).toContain('simpsons_paradox');
    expect(ids).toContain('attribution_window');
    expect(ids).toContain('seasonality');
    expect(ids).toContain('vanity_metric');
    expect(ids).toContain('goodhart');
  });

  it('stays quiet about traps that do not apply', () => {
    const r = assessEvidence({ design: 'experiment', sample: 900, unit: 'conversioni' });
    expect(r.traps).toEqual([]);
  });

  it('says the window is undeclared rather than inventing one', () => {
    expect(assessEvidence({ design: 'trend', sample: 60, unit: 'post' }).window).toContain('non dichiarata');
  });
});

describe('evidenceBlock', () => {
  it('prints level, sample, window, can/cannot and the cheapest next step', () => {
    const text = evidenceBlock(
      assessEvidence({ design: 'trend', sample: 12, unit: 'post', window: 'ultimi 7 giorni', rankedItems: 5 })
    );
    expect(text).toContain('Livello: 4/6');
    expect(text).toContain('12 post');
    expect(text).toContain('ultimi 7 giorni');
    expect(text).toContain('Cosa PUÒ sostenere');
    expect(text).toContain('Cosa NON PUÒ sostenere');
    expect(text).toContain('Osservazione più economica');
    expect(text).toContain('Trappole attive');
  });

  it('omits the trap list when there is nothing to warn about', () => {
    const text = evidenceBlock(assessEvidence({ design: 'experiment', sample: 900, unit: 'conversioni' }));
    expect(text).not.toContain('Trappole attive');
  });
});

describe('confidenceLabel', () => {
  it('gives a one-word read for tight spaces', () => {
    expect(confidenceLabel(assessEvidence({ design: 'trend', sample: 4, unit: 'post' }))).toBe('segnale insufficiente');
    expect(confidenceLabel(assessEvidence({ design: 'trend', sample: 20, unit: 'post' }))).toBe('direzionale');
    expect(confidenceLabel(assessEvidence({ design: 'natural', sample: 200, unit: 'post' }))).toBe('livello 2');
  });
});

describe('requiredSamplePerArm', () => {
  it('does the arithmetic instead of trusting a circulated table', () => {
    // The table that circulates says 12K here; the arithmetic says ~14.4K. A table that
    // UNDERSTATES the sample is what makes people stop tests early.
    expect(requiredSamplePerArm(0.1, 0.1)!).toBeGreaterThan(13_000);
    expect(requiredSamplePerArm(0.1, 0.1)!).toBeLessThan(16_000);
  });

  it('scales the way the maths says: rarer events and smaller lifts cost more', () => {
    expect(requiredSamplePerArm(0.01, 0.1)!).toBeGreaterThan(requiredSamplePerArm(0.1, 0.1)!);
    expect(requiredSamplePerArm(0.03, 0.1)!).toBeGreaterThan(requiredSamplePerArm(0.03, 0.5)!);
  });

  it('rounds to two significant figures — the inputs are estimates', () => {
    const n = requiredSamplePerArm(0.03, 0.2)!;
    expect(n % 100).toBe(0);
  });

  it('refuses inputs that cannot produce a number', () => {
    expect(requiredSamplePerArm(0, 0.2)).toBeNull();
    expect(requiredSamplePerArm(1, 0.2)).toBeNull();
    expect(requiredSamplePerArm(-0.1, 0.2)).toBeNull();
    expect(requiredSamplePerArm(0.03, 0)).toBeNull();
    expect(requiredSamplePerArm(NaN, 0.2)).toBeNull();
  });
});

describe('the powered read', () => {
  it('names the real number when the caller knows the baseline and the lift', () => {
    const r = assessEvidence({
      design: 'trend',
      sample: 4,
      unit: 'conversioni',
      baselineRate: 0.03,
      minDetectableLift: 0.2
    });
    expect(r.cheapestNextObservation).toContain('PER VARIANTE');
    // 13.000, not the 12K the circulated table claims for this cell: their number is 8% light.
    expect(r.cheapestNextObservation).toContain('13.000');
    // And says what to do when the traffic cannot supply it — the actual decision.
    expect(r.cheapestNextObservation).toContain('scarto piu');
  });

  it('stays generic when the caller does not know them, instead of inventing a baseline', () => {
    const r = assessEvidence({ design: 'trend', sample: 4, unit: 'conversioni' });
    expect(r.cheapestNextObservation).not.toContain('PER VARIANTE');
  });
});
