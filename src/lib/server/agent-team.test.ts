import { describe, expect, it } from 'vitest';
import { proposeTeam, skippedTeam, TEAM_ARCHETYPES, type TeamFacts } from './agent-team';

function facts(over: Partial<TeamFacts> = {}): TeamFacts {
  return {
    canPublish: true,
    connectedAccounts: 2,
    hasWebsite: true,
    hasBlog: true,
    hasOwnPerformanceData: true,
    hasEditorialPlan: true,
    competitors: 4,
    ...over
  };
}

const keys = (f: TeamFacts) => proposeTeam(f).map((p) => p.archetype.key);

describe('proposeTeam', () => {
  it('proposes the whole roster to a brand that has everything', () => {
    expect(keys(facts())).toEqual(TEAM_ARCHETYPES.map((a) => a.key));
  });

  it('never proposes the performance reader without own data — it would read the void weekly', () => {
    // È lo stesso errore che ha tenuto fermo l'analytics review agent: un ciclo che gira su un
    // brand senza dati propri non produce niente e costa comunque.
    expect(keys(facts({ hasOwnPerformanceData: false }))).not.toContain('performance_reader');
  });

  it('never proposes SEO or blog work to a brand with no site and no blog', () => {
    const k = keys(facts({ hasWebsite: false, hasBlog: false }));
    expect(k).not.toContain('seo_gardener');
    expect(k).not.toContain('blog_editor');
  });

  it('drops the field watch only when there is neither a site nor competitors', () => {
    expect(keys(facts({ competitors: 0 }))).toContain('field_watch');
    expect(keys(facts({ hasWebsite: false }))).toContain('field_watch');
    expect(keys(facts({ competitors: 0, hasWebsite: false }))).not.toContain('field_watch');
  });

  it('proposes nothing plan-shaped before there is a plan to execute', () => {
    const k = keys(facts({ hasEditorialPlan: false }));
    expect(k).not.toContain('week_producer');
    expect(k).not.toContain('approvals_shepherd');
    expect(k).not.toContain('brand_memory');
  });

  it('still gives export-only brands their production team', () => {
    // Go prepara ed esporta: la coda e la settimana servono lo stesso, cambia solo cosa succede
    // dopo l'approvazione. Togliergli il team sarebbe lo stesso errore del gate sugli account.
    const k = keys(facts({ canPublish: false, connectedAccounts: 0 }));
    expect(k).toContain('week_producer');
    expect(k).toContain('approvals_shepherd');
  });

  it('returns the highest-value ones first when the caller asks for a short list', () => {
    // Chi ne attiva due deve ricevere i due che tengono vivo il ciclo, non due a caso.
    expect(proposeTeam(facts(), { limit: 2 }).map((p) => p.archetype.key)).toEqual([
      'approvals_shepherd',
      'performance_reader'
    ]);
  });

  it('ignores a nonsensical limit rather than returning nothing', () => {
    expect(proposeTeam(facts(), { limit: 0 })).toHaveLength(TEAM_ARCHETYPES.length);
    expect(proposeTeam(facts(), { limit: -3 })).toHaveLength(TEAM_ARCHETYPES.length);
  });

  it('gives every proposal a reason', () => {
    for (const p of proposeTeam(facts())) expect(p.because.length).toBeGreaterThan(0);
  });
});

describe('skippedTeam', () => {
  it('is the exact complement of what was proposed', () => {
    const f = facts({ hasWebsite: false, hasBlog: false, hasOwnPerformanceData: false });
    const proposed = new Set(keys(f));
    const skipped = skippedTeam(f);
    expect(skipped.every((s) => !proposed.has(s.key))).toBe(true);
    expect(skipped.length + proposed.size).toBe(TEAM_ARCHETYPES.length);
  });

  it('says WHY each one was left out — half of an honest proposal', () => {
    for (const s of skippedTeam(facts({ hasEditorialPlan: false, hasOwnPerformanceData: false }))) {
      expect(s.why.length).toBeGreaterThan(0);
    }
  });
});

describe('archetype hygiene', () => {
  it('has unique keys', () => {
    const k = TEAM_ARCHETYPES.map((a) => a.key);
    expect(new Set(k).size).toBe(k.length);
  });

  it('uses schedule values the scheduler can actually parse', () => {
    for (const a of TEAM_ARCHETYPES) {
      expect(a.daysOfWeek.length).toBeGreaterThan(0);
      expect(a.times.length).toBeGreaterThan(0);
      for (const d of a.daysOfWeek) expect(d).toBeGreaterThanOrEqual(0), expect(d).toBeLessThanOrEqual(6);
      for (const t of a.times) expect(t).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    }
  });

  it('never schedules more work than a person can read in a week', () => {
    // Il tetto vero è 25 agenti per brand, ma un team proposto che scrive tutti i giorni non viene
    // letto: viene spento. Sette esecuzioni a settimana in tutto è già il limite del credibile.
    const runsPerWeek = TEAM_ARCHETYPES.reduce((n, a) => n + a.daysOfWeek.length * a.times.length, 0);
    expect(runsPerWeek).toBeLessThanOrEqual(10);
  });
});
