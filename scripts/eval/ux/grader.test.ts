import { describe, expect, it } from 'vitest';
import { grade, parseJudgment, RUBRIC } from './grader';

const fullJudgment = JSON.stringify({
  criteria: RUBRIC.map((c) => ({ id: c.id, verdict: 'pass', evidence: 'ok' })),
  summary: 'tutto ok'
});

describe('parseJudgment', () => {
  it('parses a well-formed judgment', () => {
    const judgment = parseJudgment(fullJudgment);
    expect(judgment?.criteria).toHaveLength(RUBRIC.length);
    expect(judgment?.summary).toBe('tutto ok');
  });

  it('extracts json surrounded by prose', () => {
    const judgment = parseJudgment(`Ecco la valutazione:\n${fullJudgment}\nfine.`);
    expect(judgment?.criteria).toHaveLength(RUBRIC.length);
  });

  it('rejects garbage', () => {
    expect(parseJudgment('non è json')).toBeNull();
    expect(parseJudgment('{"criteria": []}')).toBeNull();
    expect(parseJudgment('{"criteria": [{"id": "x", "verdict": "maybe"}]}')).toBeNull();
  });

  it('keeps only entries with a known verdict', () => {
    const judgment = parseJudgment(
      '{"criteria":[{"id":"guided-setup","verdict":"pass","evidence":"e"},{"id":"broken","verdict":"nope"}],"summary":""}'
    );
    expect(judgment?.criteria.map((c) => c.id)).toEqual(['guided-setup']);
  });
});

describe('grade', () => {
  it('is allPass when every rubric criterion passes', () => {
    const g = grade(parseJudgment(fullJudgment)!);
    expect(g.allPass).toBe(true);
    expect(g.passCount).toBe(RUBRIC.length);
    expect(g.failCount).toBe(0);
  });

  it('fails criteria the judge did not evaluate', () => {
    const judgment = parseJudgment('{"criteria":[{"id":"guided-setup","verdict":"pass","evidence":"e"}],"summary":""}');
    const g = grade(judgment!);
    expect(g.allPass).toBe(false);
    expect(g.passCount).toBe(1);
    expect(g.criteria.find((c) => c.id === 'strategy-advice')?.verdict).toBe('fail');
    expect(g.criteria.find((c) => c.id === 'strategy-advice')?.evidence).toContain('non valutato');
  });

  it('marks partial as not passing', () => {
    const judgment = parseJudgment(
      `{"criteria":[${RUBRIC.map((c) => `{"id":"${c.id}","verdict":"partial","evidence":"metà"}`).join(',')}],"summary":""}`
    );
    const g = grade(judgment!);
    expect(g.allPass).toBe(false);
    expect(g.failCount).toBe(RUBRIC.length);
  });
});
