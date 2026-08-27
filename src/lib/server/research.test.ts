import { describe, it, expect } from 'vitest';
import { personasDigest, strategyBriefFromReport, type StrategyReport } from './research';

describe('personasDigest', () => {
  const personas = [
    {
      name: 'Sara',
      role: 'Marketing Manager',
      objectives: ['grow organic reach', 'save time'],
      painPoints: ['no bandwidth', 'inconsistent output'],
      preferredChannels: ['instagram', 'linkedin']
    },
    { name: 'Marco', role: 'Founder', objectives: ['first customers'], painPoints: ['zero audience'], preferredChannels: ['x'] }
  ];

  it('builds a compact block from the stored JSON doc', () => {
    const out = personasDigest(JSON.stringify(personas));
    expect(out).toMatch(/^AUDIENCE PERSONAS/);
    expect(out).toContain('- Sara (Marketing Manager · wants: grow organic reach; save time · pains: no bandwidth; inconsistent output · channels: instagram, linkedin)');
    expect(out).toContain('- Marco (Founder');
  });

  it('caps at 4 personas and 2 objectives/pains each', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      name: `P${i}`,
      role: 'r',
      objectives: ['o1', 'o2', 'o3'],
      painPoints: ['p1', 'p2', 'p3'],
      preferredChannels: ['c1', 'c2', 'c3', 'c4']
    }));
    const out = personasDigest(JSON.stringify(many));
    expect(out).toContain('P3');
    expect(out).not.toContain('P4');
    expect(out).not.toContain('o3');
    expect(out).not.toContain('c4');
  });

  it('returns empty on missing, malformed or empty input', () => {
    expect(personasDigest(null)).toBe('');
    expect(personasDigest(undefined)).toBe('');
    expect(personasDigest('not json')).toBe('');
    expect(personasDigest('[]')).toBe('');
    expect(personasDigest(JSON.stringify([{ role: 'no name' }]))).toBe('');
  });
});

describe('strategyBriefFromReport', () => {
  const report: StrategyReport = {
    summary: 's',
    competitiveLandscape: 'l',
    whiteSpace: ['behind-the-scenes content'],
    differentiators: ['real product photos'],
    threats: ['copying the market leader tone'],
    recommendedAngles: ['founder-led storytelling'],
    platformGuidance: []
  };

  it('carries angles, white space, differentiators AND threats (full competitiveDelta signal)', () => {
    const out = strategyBriefFromReport(report);
    expect(out).toContain('founder-led storytelling');
    expect(out).toContain('behind-the-scenes content');
    expect(out).toContain('real product photos');
    expect(out).toContain('Avoid the crowded/risky moves: copying the market leader tone.');
  });

  it('skips empty sections', () => {
    const out = strategyBriefFromReport({ ...report, threats: [], whiteSpace: [] });
    expect(out).not.toContain('Avoid the crowded');
    expect(out).not.toContain('White space');
  });
});
