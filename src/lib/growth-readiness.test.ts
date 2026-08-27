import { describe, expect, it } from 'vitest';
import { evaluateGrowthReadiness, growthReadinessMessage, type GrowthSnapshot } from './growth-readiness';

function base(over: Partial<GrowthSnapshot> = {}): GrowthSnapshot {
  return {
    slug: 'acme',
    about: true,
    audience: true,
    personality: true,
    voiceKit: true,
    historyCount: 20,
    hasSocialHandles: true,
    competitorCount: 2,
    productCount: 3,
    hasVisualStyle: true,
    documentCount: 2,
    hasEditorialPlan: true,
    ...over
  };
}

describe('evaluateGrowthReadiness', () => {
  it('is ready when core growth inputs are present', () => {
    const r = evaluateGrowthReadiness(base());
    expect(r.ready).toBe(true);
    expect(r.blocking).toHaveLength(0);
  });

  it('blocks when about, voice, history, or competitors are missing', () => {
    expect(evaluateGrowthReadiness(base({ about: false })).ready).toBe(false);
    expect(evaluateGrowthReadiness(base({ personality: false, voiceKit: false })).ready).toBe(false);
    expect(evaluateGrowthReadiness(base({ historyCount: 0 })).ready).toBe(false);
    expect(evaluateGrowthReadiness(base({ historyCount: 4 })).ready).toBe(false);
    expect(evaluateGrowthReadiness(base({ competitorCount: 0 })).ready).toBe(false);
  });

  it('accepts kit voice without editorial personality', () => {
    const r = evaluateGrowthReadiness(base({ personality: false, voiceKit: true }));
    expect(r.ready).toBe(true);
    expect(r.checks.find((c) => c.key === 'voice')?.ok).toBe(true);
  });

  it('warns on thin history without blocking once past the floor', () => {
    const r = evaluateGrowthReadiness(base({ historyCount: 7 }));
    expect(r.ready).toBe(true);
    expect(r.blocking).toHaveLength(0);
    expect(r.warnings.some((w) => w.key === 'historyDepth')).toBe(true);
  });

  it('warns (never blocks) when the website or GSC are missing', () => {
    const r = evaluateGrowthReadiness(base({ hasWebsite: false, gscConnected: false }));
    expect(r.ready).toBe(true);
    expect(r.blocking).toHaveLength(0);
    const web = r.checks.find((c) => c.key === 'web');
    const gsc = r.checks.find((c) => c.key === 'gsc');
    expect(web?.ok).toBe(false);
    expect(web?.blocking).toBe(false);
    expect(web?.fix).toBe('/app/acme/site');
    expect(gsc?.ok).toBe(false);
    expect(gsc?.blocking).toBe(false);
    expect(gsc?.fix).toBe('/app/acme/settings/search-console');
  });

  it('treats unset web/gsc snapshot fields as ok (opt-in checks)', () => {
    const r = evaluateGrowthReadiness(base());
    expect(r.checks.find((c) => c.key === 'web')?.ok).toBe(true);
    expect(r.checks.find((c) => c.key === 'gsc')?.ok).toBe(true);
  });

  it('warns (never blocks) when no active social account is connected', () => {
    const r = evaluateGrowthReadiness(base({ hasSocialAccounts: false }));
    expect(r.ready).toBe(true);
    expect(r.blocking).toHaveLength(0);
    const c = r.checks.find((c) => c.key === 'social_connect');
    expect(c?.ok).toBe(false);
    expect(c?.blocking).toBe(false);
    expect(c?.fix).toBe('/app/acme/settings/connected-accounts');
    expect(r.warnings.some((w) => w.key === 'social_connect')).toBe(true);
  });

  it('treats unset hasSocialAccounts as ok (opt-in check)', () => {
    const r = evaluateGrowthReadiness(base());
    expect(r.checks.find((c) => c.key === 'social_connect')?.ok).toBe(true);
  });

  it('formats a remediation message listing blocking keys', () => {
    const r = evaluateGrowthReadiness(base({ about: false, competitorCount: 0 }));
    const msg = growthReadinessMessage(r);
    expect(msg).toContain('better brand data');
    expect(msg).toContain('about');
    expect(msg).toContain('competitors');
  });
});
