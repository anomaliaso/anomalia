import { describe, expect, it } from 'vitest';
import { DIAGNOSE_RADAR } from './market';
import { BRAND_ENDPOINTS } from './index';

describe('il contratto delle misure del mercato', () => {
  it('espone solo letture: interrogare le fonti non le cambia', () => {
    expect(DIAGNOSE_RADAR.method).toBe('GET');
    expect(DIAGNOSE_RADAR.destructive).toBe(false);
  });

  it('è registrata, o il tool MCP non nasce', () => {
    expect(BRAND_ENDPOINTS).toContain(DIAGNOSE_RADAR);
  });

  it('rifiuta un parametro che non dichiara invece di scartarlo in silenzio', () => {
    expect(DIAGNOSE_RADAR.input.safeParse({ campo_che_non_esiste: 'x' }).success).toBe(false);
  });

  it('la diagnosi del radar esce di casa, e lo dichiara', () => {
    expect(DIAGNOSE_RADAR.openWorld).toBe(true);
  });

  it('una fonte del radar dice quanti item ha trovato, o perché non ne ha trovati', () => {
    const base = {
      enabled: true,
      plan: 'pro',
      proLeads: true,
      scrapecreatorsConfigured: true,
      platforms: { reddit: true },
      engagePlatforms: ['reddit'],
      note: 'x'
    };
    const found = { kind: 'rss', value: 'https://x.it/feed', active: true, allowedByPlan: true, enabled: true, platform: null, items: 3 };
    expect(DIAGNOSE_RADAR.output.safeParse({ ...base, sources: [found] }).success).toBe(true);
    expect(
      DIAGNOSE_RADAR.output.safeParse({ ...base, sources: [{ ...found, items: 0, skipped: 'source is off' }] }).success
    ).toBe(true);
    expect(
      DIAGNOSE_RADAR.output.safeParse({ ...base, sources: [{ ...found, items: 0, error: 'HTTP 503' }] }).success
    ).toBe(true);
    const { items: _omitted, ...senzaConto } = found;
    expect(DIAGNOSE_RADAR.output.safeParse({ ...base, sources: [senzaConto] }).success).toBe(false);
  });
});
