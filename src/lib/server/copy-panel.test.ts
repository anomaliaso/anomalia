import { describe, expect, it } from 'vitest';
import {
  COPY_PANEL_MAX_ROUNDS,
  COPY_PANEL_SCHEMA,
  PANEL_PERSPECTIVES,
  bandOfScore,
  bestOf,
  normalizeVerdict,
  panelSummary,
  stripJudgeScaffolding,
  toIterate,
  toReplace,
  type PanelVerdict
} from './copy-panel';

const verdict = (index: number, scores: number[], caption = 'riscritta'): PanelVerdict =>
  normalizeVerdict({
    index,
    scores: Object.fromEntries(PANEL_PERSPECTIVES.map((p, i) => [p, scores[i]])),
    objection: 'un rivale potrebbe incollarci il proprio logo',
    caption
  })!;

describe('bandOfScore', () => {
  it('ships at 85, iterates in the middle, kills under 70', () => {
    expect(bandOfScore(92)).toBe('ship');
    expect(bandOfScore(85)).toBe('ship');
    expect(bandOfScore(84)).toBe('iterate');
    expect(bandOfScore(70)).toBe('iterate');
    expect(bandOfScore(69)).toBe('kill');
  });
});

describe('normalizeVerdict', () => {
  it('recomputes the total from the parts instead of trusting it', () => {
    const v = normalizeVerdict({
      index: 0,
      scores: { skeptic: 10, stranger: 10, competitor: 10, buyer: 10, editor: 10 },
      total: 99, // a model total that does not add up
      objection: 'x',
      caption: 'y'
    })!;
    expect(v.total).toBe(50);
  });

  it('clamps a perspective to 0..20', () => {
    const v = normalizeVerdict({
      index: 0,
      scores: { skeptic: 900, stranger: -5, competitor: 20, buyer: 20, editor: 20 },
      objection: 'x',
      caption: 'y'
    })!;
    expect(v.scores.skeptic).toBe(20);
    expect(v.scores.stranger).toBe(0);
    expect(v.total).toBe(80);
  });

  it('treats a missing perspective as zero rather than dropping the verdict', () => {
    const v = normalizeVerdict({ index: 1, scores: { skeptic: 20 }, objection: 'x', caption: 'y' })!;
    expect(v.total).toBe(20);
  });

  it('rejects junk', () => {
    expect(normalizeVerdict(null)).toBeNull();
    expect(normalizeVerdict({ index: 'nope' })).toBeNull();
    expect(normalizeVerdict({ index: -1 })).toBeNull();
  });

  it('omits the caption field when the model returned nothing to use', () => {
    expect(normalizeVerdict({ index: 0, scores: {}, objection: 'x', caption: '  ' })!.caption).toBeUndefined();
  });
});

describe('toIterate', () => {
  it('carries only the middle band forward', () => {
    const vs = [verdict(0, [20, 20, 20, 20, 20]), verdict(1, [16, 16, 16, 16, 16]), verdict(2, [5, 5, 5, 5, 5])];
    expect(toIterate(vs, 1).map((v) => v.index)).toEqual([1]);
  });

  it('stops at the round cap — beyond that it is polishing, not improving', () => {
    const vs = [verdict(1, [16, 16, 16, 16, 16])];
    expect(toIterate(vs, COPY_PANEL_MAX_ROUNDS)).toEqual([]);
  });

  it('drops a mid-band verdict with no rewrite — there is nothing new to score', () => {
    const vs = [verdict(1, [16, 16, 16, 16, 16], '')];
    expect(toIterate(vs, 1)).toEqual([]);
  });
});

describe('toReplace', () => {
  it('replaces the killed captions outright', () => {
    const vs = [verdict(0, [20, 20, 20, 20, 20]), verdict(2, [5, 5, 5, 5, 5])];
    expect(toReplace(vs).map((v) => v.index)).toEqual([2]);
  });
});

describe('bestOf', () => {
  it('keeps the better attempt, because an iteration can make a caption worse', () => {
    const before = verdict(0, [16, 16, 16, 16, 16]); // 80
    const worse = verdict(0, [10, 10, 10, 10, 10]); // 50
    const better = verdict(0, [18, 18, 18, 18, 18]); // 90
    expect(bestOf(before, worse).total).toBe(80);
    expect(bestOf(before, better).total).toBe(90);
    expect(bestOf(undefined, worse).total).toBe(50);
  });

  it('prefers the newer attempt on a tie, so a later fix is not discarded', () => {
    const before = verdict(0, [16, 16, 16, 16, 16], 'prima');
    const tie = verdict(0, [16, 16, 16, 16, 16], 'dopo');
    expect(bestOf(before, tie).caption).toBe('dopo');
  });
});

describe('panelSummary', () => {
  it('says what the panel actually did', () => {
    const s = panelSummary([verdict(0, [20, 20, 20, 20, 20]), verdict(1, [16, 16, 16, 16, 16]), verdict(2, [5, 5, 5, 5, 5])]);
    expect(s).toContain('3 caption');
    expect(s).toContain('1 pronte');
    expect(s).toContain('1 da iterare');
    expect(s).toContain('1 da riscrivere');
  });
});

describe('COPY_PANEL_SCHEMA', () => {
  it('asks for ONE objection, not a list', () => {
    const objection = COPY_PANEL_SCHEMA.properties.verdicts.items.properties.objection.description;
    expect(objection).toContain('Una sola');
  });

  it('carries the competitor logo test, which is the sharpest of the five', () => {
    const competitor = COPY_PANEL_SCHEMA.properties.verdicts.items.properties.scores.properties.competitor.description;
    expect(competitor).toContain('logo');
    expect(competitor).toContain('decorazione');
  });

  it('requires all five perspectives', () => {
    expect(COPY_PANEL_SCHEMA.properties.verdicts.items.properties.scores.required).toEqual([...PANEL_PERSPECTIVES]);
  });
});

// Vista dal vivo: una fix del chief spedita con "[reddit | subreddit: r/SaaS | title: …]" e
// "HASHTAGS: (none)" in testa — l'impalcatura della lista ricopiata nella caption.
describe('stripJudgeScaffolding', () => {
  it('strips the list header + HASHTAGS line a judge echoed into its rewrite', () => {
    const raw = '[reddit | subreddit: r/SaaS | title: Q4 in 60 minutes]\nHASHTAGS: (none)\nQ4 planning does not need an agency.';
    expect(stripJudgeScaffolding(raw)).toBe('Q4 planning does not need an agency.');
    expect(stripJudgeScaffolding('2. [instagram · product: X]\nLa caption vera.')).toBe('La caption vera.');
  });

  it('leaves a clean caption untouched', () => {
    const clean = 'Tre resi su dieci partono da una taglia sbagliata.\n\nLa tabella è nella foto.';
    expect(stripJudgeScaffolding(clean)).toBe(clean);
  });

  it('flows through normalizeVerdict', () => {
    const v = normalizeVerdict({ index: 0, scores: { skeptic: 10, stranger: 10, competitor: 10, buyer: 10, editor: 10 }, objection: 'x', caption: '[x]\nRiscritta.' });
    expect(v?.caption).toBe('Riscritta.');
  });
});
