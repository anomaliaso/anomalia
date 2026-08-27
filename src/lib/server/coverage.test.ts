import { describe, expect, it } from 'vitest';
import {
  bandOf,
  calibrationDrift,
  gapsSection,
  gradeWithCoverage,
  type CoverageSignal
} from './coverage';

const sig = (key: string, verdict: CoverageSignal['verdict'], weight = 10, value?: number): CoverageSignal => ({
  key,
  label: key,
  weight,
  verdict,
  ...(value === undefined ? {} : { value })
});

describe('gradeWithCoverage', () => {
  it('scores over the INSPECTED weight, not the total', () => {
    // 2 pass, 1 fail, 1 unknown: 20 earned of 30 inspected = 66.7, not 50 of 40.
    const g = gradeWithCoverage([sig('a', 'pass'), sig('b', 'pass'), sig('c', 'fail'), sig('d', 'unknown')]);
    expect(g.score).toBe(66.7);
    expect(g.inspectedWeight).toBe(30);
    expect(g.applicableWeight).toBe(40);
  });

  it('keeps an unknown off the score and on the coverage', () => {
    const withUnknown = gradeWithCoverage([sig('a', 'pass'), sig('b', 'pass'), sig('c', 'unknown')]);
    const withoutIt = gradeWithCoverage([sig('a', 'pass'), sig('b', 'pass')]);
    expect(withUnknown.score).toBe(withoutIt.score);
    expect(withUnknown.coverage).toBeLessThan(withoutIt.coverage);
  });

  it('never converts an unknown into a fail or a pass', () => {
    const unknown = gradeWithCoverage([sig('a', 'pass'), sig('b', 'pass'), sig('c', 'unknown')]);
    const asFail = gradeWithCoverage([sig('a', 'pass'), sig('b', 'pass'), sig('c', 'fail')]);
    const asPass = gradeWithCoverage([sig('a', 'pass'), sig('b', 'pass'), sig('c', 'pass')]);
    expect(unknown.score).toBeGreaterThan(asFail.score!);
    expect(unknown.score).toBe(asPass.score); // same score…
    expect(unknown.coverage).toBeLessThan(asPass.coverage); // …but the evidence is visibly thinner
  });

  it('drops a not-applicable signal out of the calculation entirely', () => {
    const g = gradeWithCoverage([sig('a', 'pass'), sig('b', 'na')]);
    expect(g.score).toBe(100);
    expect(g.coverage).toBe(100);
    expect(g.applicableWeight).toBe(10);
    expect(g.notApplicable).toEqual(['b']);
  });

  it('marks 60-79% coverage as provisional and names what is missing', () => {
    const g = gradeWithCoverage([
      sig('a', 'pass'),
      sig('b', 'pass'),
      sig('c', 'unknown'),
      sig('d', 'pass'),
      sig('e', 'unknown')
    ]);
    expect(g.coverage).toBe(60);
    expect(g.tier).toBe('provisional');
    expect(g.score).toBe(100);
    expect(g.label).toContain('PROVVISORIO');
    expect(g.label).toContain('c');
    expect(g.label).toContain('e');
  });

  it('refuses to publish a score under 60% coverage', () => {
    const g = gradeWithCoverage([sig('a', 'pass'), sig('b', 'unknown'), sig('c', 'unknown')]);
    expect(g.tier).toBe('ungraded');
    expect(g.score).toBeNull();
    expect(g.label).toContain('Evidenza insufficiente');
  });

  it('returns ungraded rather than zero when nothing is applicable', () => {
    const g = gradeWithCoverage([sig('a', 'na'), sig('b', 'na')]);
    expect(g.score).toBeNull();
    expect(g.tier).toBe('ungraded');
  });

  it('honours graded 0..1 values so a small regression is visible', () => {
    const g = gradeWithCoverage([sig('a', 'pass', 10, 0.5), sig('b', 'pass', 10, 1)]);
    expect(g.score).toBe(75);
  });

  it('respects weights', () => {
    const g = gradeWithCoverage([sig('heavy', 'fail', 90), sig('light', 'pass', 10)]);
    expect(g.score).toBe(10);
  });
});

describe('bandOf', () => {
  it('maps a score to its band', () => {
    expect(bandOf(95).id).toBe('best_in_class');
    expect(bandOf(80).id).toBe('strong');
    expect(bandOf(65).id).toBe('functional');
    expect(bandOf(45).id).toBe('leaking');
    expect(bandOf(25).id).toBe('broken');
    expect(bandOf(5).id).toBe('absent');
  });
});

describe('calibrationDrift', () => {
  it('says nothing on a sample too small to judge', () => {
    expect(calibrationDrift([90, 92, 95])).toBeNull();
  });

  it('flags bands that have drifted upward', () => {
    const d = calibrationDrift([88, 90, 91, 92, 93, 94, 95, 96])!;
    expect(d.drifted).toBe(true);
    expect(d.note).toContain('55');
  });

  it('accepts a median inside the expected band', () => {
    const d = calibrationDrift([40, 52, 58, 61, 63, 67, 72, 80])!;
    expect(d.drifted).toBe(false);
  });
});

describe('gapsSection', () => {
  it('names every uninspected and inapplicable dimension', () => {
    const g = gradeWithCoverage([sig('a', 'pass'), sig('b', 'unknown'), sig('c', 'na')]);
    const text = gapsSection(g, ['prezzo: pagina protetta da login']);
    expect(text).toContain('b');
    expect(text).toContain('c');
    expect(text).toContain('prezzo');
  });

  it('still says something when there is nothing to declare', () => {
    const g = gradeWithCoverage([sig('a', 'pass')]);
    expect(gapsSection(g)).toContain('niente');
  });
});
