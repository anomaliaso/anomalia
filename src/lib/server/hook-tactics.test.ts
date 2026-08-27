import { describe, expect, it } from 'vitest';
import {
  HOOK_TACTICS,
  HOOK_TACTIC_IDS,
  NON_TEXTUAL_TACTICS,
  classifyHookTactic,
  hookCoverage,
  hookTacticById,
  hookTaxonomyBrief,
  openingLine,
  type HookUsage
} from './hook-tactics';

describe('the taxonomy', () => {
  it('has eighteen tactics, each with a disambiguation and a failure mode', () => {
    expect(HOOK_TACTIC_IDS).toHaveLength(18);
    expect(HOOK_TACTICS).toHaveLength(18);
    for (const t of HOOK_TACTICS) {
      expect(t.what.length).toBeGreaterThan(10);
      expect(t.notToConfuseWith.length).toBeGreaterThan(5);
      expect(t.failsWhen.length).toBeGreaterThan(10);
    }
  });

  it('has no duplicate ids', () => {
    expect(new Set(HOOK_TACTIC_IDS).size).toBe(HOOK_TACTIC_IDS.length);
  });

  it('marks the three tactics text cannot identify', () => {
    expect(NON_TEXTUAL_TACTICS.sort()).toEqual(['implied_answer', 'pattern_interrupt', 'story_cold_open']);
  });
});

describe('openingLine', () => {
  it('reads the first non-empty line', () => {
    expect(openingLine('\n\nPrima riga\nSeconda')).toBe('Prima riga');
  });

  it('cuts a very long single line at the first sentence end', () => {
    const long = `${'a'.repeat(210)}. resto`;
    expect(openingLine(long).length).toBeLessThanOrEqual(200);
  });
});

describe('classifyHookTactic', () => {
  const cases: Array<[string, string]> = [
    ['Se gestisci le ads di un e-commerce, questo ti riguarda', 'callout'],
    ['Per gli studi che inseguono ancora i preventivi via email', 'identity'],
    ['Ho analizzato 400 account pubblicitari e sono tutti rotti', 'authority'],
    ['12.000 team hanno cambiato gestionale lo scorso anno', 'social_proof'],
    ['Tutti dicono che serve postare ogni giorno', 'contrarian'],
    ['Stai perdendo tre clienti al mese e non lo sai', 'fear_loss'],
    ['Nessuno ti dice perché i preventivi muoiono', 'curiosity_gap'],
    ['Il vecchio modo era chiamare uno per uno', 'borrowed_enemy'],
    ['Da 6 giorni a 4 ore, senza assumere nessuno', 'outcome'],
    ['Guarda cosa succede quando arriva il preventivo', 'demonstration'],
    ['Ho appena visto una cosa assurda nel gestionale', 'social_witness'],
    ['Nota: ho smesso di mandare report ai clienti', 'trojan_horse'],
    ['Vuoi davvero continuare così?', 'question'],
    ['68% dei preventivi si perde nelle prime 48 ore', 'stat_lead']
  ];

  for (const [text, expected] of cases) {
    it(`labels "${text.slice(0, 34)}…" as ${expected}`, () => {
      expect(classifyHookTactic(text)?.tactic).toBe(expected);
    });
  }

  it('returns null rather than guessing when nothing matches', () => {
    expect(classifyHookTactic('Il nuovo catalogo primavera è online.')).toBeNull();
    expect(classifyHookTactic('')).toBeNull();
    expect(classifyHookTactic(null)).toBeNull();
  });

  it('marks the broad shape rules as low confidence', () => {
    expect(classifyHookTactic('Vuoi davvero continuare così?')?.confidence).toBe('low');
    expect(classifyHookTactic('Se gestisci le ads di un e-commerce, questo ti riguarda')?.confidence).toBe('high');
  });

  it('prefers the specific rule over the broad one when both would fire', () => {
    // Contains a question mark AND a phrase pattern: the phrase pattern wins.
    expect(classifyHookTactic('Tutti dicono che serve postare ogni giorno, ma è vero?')?.tactic).toBe('contrarian');
  });
});

describe('hookCoverage', () => {
  const used: HookUsage[] = [
    { tactic: 'question', format: 'carousel' },
    { tactic: 'stat_lead', format: 'reel', wonAgainstAverage: true },
    { tactic: 'callout', format: 'text_post' }
  ];

  it('reports which tactics ran and how much of the space that covers', () => {
    const c = hookCoverage(used);
    expect(c.used.sort()).toEqual(['callout', 'question', 'stat_lead']);
    expect(c.coverage).toBeCloseTo(16.7, 1);
    expect(c.untested).toContain('trojan_horse');
    expect(c.untested).not.toContain('question');
  });

  it('ranks a proven angle in an untested format above a brand-new angle', () => {
    const c = hookCoverage(used, { knownFormats: ['reel', 'carousel', 'text_post'] });
    const top = c.gaps[0];
    expect(top.tactic).toBe('stat_lead'); // the one that won
    expect(['carousel', 'text_post']).toContain(top.format);
    expect(top.why).toContain('validato');
  });

  it('ranks the tactics text cannot detect last, and says why', () => {
    const c = hookCoverage(used);
    const nonTextual = c.gaps.filter((g) => NON_TEXTUAL_TACTICS.includes(g.tactic));
    const textual = c.gaps.filter((g) => !NON_TEXTUAL_TACTICS.includes(g.tactic) && !g.format);
    for (const nt of nonTextual) {
      for (const t of textual) expect(nt.priority).toBeLessThanOrEqual(t.priority);
      expect(nt.why).toContain('non è rilevabile dal testo');
    }
  });

  it('counts an unlabelled opening against coverage instead of into a bucket', () => {
    const c = hookCoverage([...used, { tactic: 'nope' as never }]);
    expect(c.unclassified).toBe(1);
    expect(c.used).toHaveLength(3);
    expect(c.brief).toContain('non classificabili');
  });

  it('produces a brief a planner can paste', () => {
    const c = hookCoverage(used, { knownFormats: ['reel', 'carousel'] });
    expect(c.brief).toContain('COPERTURA DEGLI HOOK');
    expect(c.brief).toContain('3/18');
    expect(c.brief).toContain('Prossimi test');
  });

  it('handles a brand with no history at all', () => {
    const c = hookCoverage([]);
    expect(c.used).toEqual([]);
    expect(c.untested).toHaveLength(18);
    expect(c.coverage).toBe(0);
  });
});

describe('hookTaxonomyBrief', () => {
  it('carries the disambiguation into the prompt, which is the part that stops the collapse', () => {
    const brief = hookTaxonomyBrief();
    expect(brief).toContain('NON confondere con');
    expect(brief).toContain('Fallisce quando');
    for (const id of HOOK_TACTIC_IDS) expect(brief).toContain(id);
  });

  it('can drop the failure modes when the prompt budget is tight', () => {
    expect(hookTaxonomyBrief({ includeFailures: false })).not.toContain('Fallisce quando');
  });
});

describe('hookTacticById', () => {
  it('resolves a known id and refuses an unknown one', () => {
    expect(hookTacticById('trojan_horse')?.label).toBe('Cavallo di Troia');
    expect(hookTacticById('nope')).toBeNull();
  });
});
