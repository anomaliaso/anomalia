import { describe, expect, it } from 'vitest';
import { byLadderPriority, ladderBrief, ladderFor, type LadderContext } from './production-ladder';

const ctx: LadderContext = { proven: ['stat_lead'], tried: ['stat_lead', 'question'], coldStart: false };

describe('ladderFor', () => {
  it('sends a validated angle to real production', () => {
    const v = ladderFor('stat_lead', ctx);
    expect(v.rung).toBe(3);
    expect(v.earnsVideo).toBe(true);
  });

  it('gives a tried-but-unproven angle cheap motion, not production', () => {
    const v = ladderFor('question', ctx);
    expect(v.rung).toBe(2);
    expect(v.earnsVideo).toBe(true);
  });

  it('makes a never-tried angle buy its reading with a static first', () => {
    const v = ladderFor('trojan_horse', ctx);
    expect(v.rung).toBe(1);
    expect(v.earnsVideo).toBe(false);
    expect(v.reason).toContain('mai stato provato');
  });

  it('treats an unclassifiable opening as unproven, because it is', () => {
    const v = ladderFor(null, ctx);
    expect(v.rung).toBe(1);
    expect(v.earnsVideo).toBe(false);
  });

  it('does NOT force a cold-start brand down to statics', () => {
    // No history means no ranking. Starving a new feed of motion would be the wrong read of the
    // ladder: we are not ranking angles, so we do not pretend to.
    const cold: LadderContext = { proven: [], tried: [], coldStart: true };
    expect(ladderFor('trojan_horse', cold).rung).toBe(2);
    expect(ladderFor(null, cold).earnsVideo).toBe(true);
  });

  it('always explains the allocation, so no spend decision is silent', () => {
    for (const tactic of ['stat_lead', 'question', 'trojan_horse'] as const) {
      expect(ladderFor(tactic, ctx).reason.length).toBeGreaterThan(20);
    }
  });
});

describe('byLadderPriority', () => {
  it('puts the angles that earned the spend first', () => {
    const items = [{ id: 'a', rung: 1 as const }, { id: 'b', rung: 3 as const }, { id: 'c', rung: 2 as const }];
    expect(byLadderPriority(items, (i) => i.rung).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('is stable inside a rung, so the planner\'s editorial order survives', () => {
    const items = [{ id: 'a', rung: 2 as const }, { id: 'b', rung: 2 as const }, { id: 'c', rung: 2 as const }];
    expect(byLadderPriority(items, (i) => i.rung).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input', () => {
    const items = [{ id: 'a', rung: 1 as const }, { id: 'b', rung: 3 as const }];
    byLadderPriority(items, (i) => i.rung);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('ladderBrief', () => {
  it('states the rule and names the proven angles', () => {
    const text = ladderBrief(ctx);
    expect(text).toContain('SCALA DI FEDELTÀ');
    expect(text).toContain('stat_lead');
    expect(text).toContain('Saltare i pioli');
  });

  it('says plainly that a cold-start brand has nothing validated yet', () => {
    const text = ladderBrief({ proven: [], tried: [], coldStart: true });
    expect(text).toContain('nessuno storico');
    expect(text).not.toContain('Saltare i pioli');
  });
});
