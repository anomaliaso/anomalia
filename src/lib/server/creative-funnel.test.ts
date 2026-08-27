import { describe, expect, it } from 'vitest';
import { DEFAULT_FUNNEL_FLOORS, diagnoseCreativeFunnel, funnelBrief } from './creative-funnel';

const healthy = { thumbstop: 0.3, hold: 0.4, ctr: 0.02, cvr: 0.03 };

describe('diagnoseCreativeFunnel', () => {
  it('blames the visual when the thumbstop is broken', () => {
    const d = diagnoseCreativeFunnel({ ...healthy, thumbstop: 0.05 });
    expect(d.stage).toBe('thumbstop');
    expect(d.fix).toContain('AZIONE VISIVA');
    expect(d.doNot).toContain('battuta parlata');
  });

  it('stops at the FIRST broken stage even when later ones are broken too', () => {
    const d = diagnoseCreativeFunnel({ thumbstop: 0.05, hold: 0.01, ctr: 0.0001, cvr: 0.0001 });
    expect(d.stage).toBe('thumbstop');
  });

  it('blames the on-ramp, not the hook, when hold is broken', () => {
    const d = diagnoseCreativeFunnel({ ...healthy, hold: 0.05 });
    expect(d.stage).toBe('hold');
    expect(d.fix).toContain('RAMPA');
    expect(d.doNot).toContain("apertura");
    // Every hook test is also an on-ramp test — the verdict has to say so.
    expect(d.doNot).toContain('rampa');
  });

  it('blames the offer, not more hooks, when people watch and do not click', () => {
    const d = diagnoseCreativeFunnel({ ...healthy, ctr: 0.001 });
    expect(d.stage).toBe('ctr');
    expect(d.doNot).toContain('altri hook');
  });

  it('sends a post-click failure to the landing page and forbids the usual waste', () => {
    const d = diagnoseCreativeFunnel({ ...healthy, cvr: 0.0001 });
    expect(d.stage).toBe('cvr');
    expect(d.fix).toContain('PAGINA DI DESTINAZIONE');
    expect(d.doNot).toContain('spreco più comune');
  });

  it('treats a missing rate as unreadable, never as a failure', () => {
    const d = diagnoseCreativeFunnel({ thumbstop: null, hold: 0.4, ctr: 0.02, cvr: 0.03 });
    expect(d.stage).toBe('healthy');
    expect(d.unreadable).toEqual(['thumbstop']);
  });

  it('moves down the funnel when an upper stage is unreadable', () => {
    const d = diagnoseCreativeFunnel({ hold: 0.05, ctr: 0.02 });
    expect(d.stage).toBe('hold');
    expect(d.unreadable).toEqual(['thumbstop']);
  });

  it('says unreadable rather than healthy when nothing could be read', () => {
    const d = diagnoseCreativeFunnel({});
    expect(d.stage).toBe('unreadable');
    expect(d.unreadable).toHaveLength(4);
  });

  it('accepts account-specific floors, because a category median beats a default', () => {
    const rates = { ...healthy, thumbstop: 0.25 };
    expect(diagnoseCreativeFunnel(rates).stage).toBe('healthy');
    expect(diagnoseCreativeFunnel(rates, { thumbstop: 0.4 }).stage).toBe('thumbstop');
  });

  it('ignores a floor override that is not a number', () => {
    expect(diagnoseCreativeFunnel(healthy, { thumbstop: null }).stage).toBe('healthy');
    expect(DEFAULT_FUNNEL_FLOORS.thumbstop).toBe(0.2);
  });
});

describe('funnelBrief', () => {
  it('names the unreadable stages instead of quietly skipping them', () => {
    const text = funnelBrief(diagnoseCreativeFunnel({ thumbstop: 0.3, hold: 0.4 }));
    expect(text).toContain('non leggibili');
    expect(text).toContain('ctr');
    expect(text).toContain('cvr');
  });

  it('prints what to change and what not to do', () => {
    const text = funnelBrief(diagnoseCreativeFunnel({ ...healthy, cvr: 0.0001 }));
    expect(text).toContain('Da cambiare');
    expect(text).toContain('Da NON fare');
  });
});
