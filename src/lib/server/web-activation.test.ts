import { describe, expect, it } from 'vitest';
import { getWebActivationStatus, firstSteps, type WebActivationStepKey } from './web-activation';
import { createTestSupabase } from '$lib/testkit/supabase';

type TableConfig = { row?: unknown; count?: number };

/**
 * Mock supabase condiviso (src/lib/testkit): le count-query diventano N righe seminate
 * con il brand_id giusto — il `.eq('brand_id')` del codice le deve filtrare davvero,
 * e il testkit risolve `count` come PostgREST (righe che matchano, head:true → data null).
 * La firma per-test resta { row, count } per tenere il diff dei casi minimo.
 */
function mockClient(tables: Record<string, TableConfig | unknown>) {
  const seed: Record<string, Record<string, unknown>[]> = {};
  for (const [table, cfg] of Object.entries(tables)) {
    const isConfig =
      cfg && typeof cfg === 'object' && !Array.isArray(cfg) && ('count' in cfg || 'row' in cfg);
    const config: TableConfig = isConfig ? (cfg as TableConfig) : { row: cfg };
    if (config.count != null) {
      seed[table] = Array.from({ length: config.count }, (_, i) => ({ id: `${table}-${i}`, brand_id: 'brand-1' }));
    } else {
      seed[table] = config.row ? [config.row as Record<string, unknown>] : [];
    }
  }
  return createTestSupabase(seed).client;
}

const BRAND_ROW = { id: 'brand-1', slug: 'acme', website: 'https://acme.com' };

describe('getWebActivationStatus', () => {
  it('reports all three steps done when website, GSC and a GEO audit exist', async () => {
    const admin = mockClient({
      brands: { row: BRAND_ROW },
      brand_gsc_connections: { count: 1 },
      brand_geo_audits: { count: 2 }
    });
    const status = await getWebActivationStatus(admin, 'brand-1');
    expect(status).toEqual({
      hasWebsite: true,
      gscConnected: true,
      hasGeoAudit: true,
      nextSteps: []
    });
  });

  it('reports nothing configured with the three steps in order', async () => {
    const admin = mockClient({
      brands: { row: { id: 'brand-1', slug: 'acme', website: '' } },
      brand_gsc_connections: { count: 0 },
      brand_geo_audits: { count: 0 }
    });
    const status = await getWebActivationStatus(admin, 'brand-1');
    expect(status.hasWebsite).toBe(false);
    expect(status.gscConnected).toBe(false);
    expect(status.hasGeoAudit).toBe(false);
    // kill seo/geo 2026-08-29: due passi, non più tre.
    expect(status.nextSteps).toHaveLength(2);
    expect(status.nextSteps[0]).toMatch(/website/i);
    expect(status.nextSteps[1]).toMatch(/search console/i);
    // kill seo/geo 2026-08-29: il passo "GEO audit" non è più parte del funnel.
    expect(status.nextSteps[2]).toBeUndefined();
  });

  it('treats a missing brand row as no website', async () => {
    const admin = mockClient({
      brands: { row: null },
      brand_gsc_connections: { count: 1 },
      brand_geo_audits: { count: 1 }
    });
    const status = await getWebActivationStatus(admin, 'brand-1');
    expect(status.hasWebsite).toBe(false);
    expect(status.gscConnected).toBe(true);
    expect(status.hasGeoAudit).toBe(true);
  });
});

describe('firstSteps', () => {
  it('returns the ordered steps with app paths and done flags', async () => {
    const admin = mockClient({
      brands: { row: BRAND_ROW },
      brand_gsc_connections: { count: 0 },
      brand_geo_audits: { count: 0 }
    });
    const steps = await firstSteps(admin, 'brand-1');
    // kill seo/geo 2026-08-29: il passo "GEO audit" non è più parte del funnel.
    expect(steps.map((s) => s.key as WebActivationStepKey)).toEqual(['website', 'gsc']);
    expect(steps[0]).toMatchObject({ key: 'website', done: true, href: '/app/acme/site' });
    expect(steps[1]).toMatchObject({
      key: 'gsc',
      done: false,
      href: '/app/acme/settings/search-console'
    });
  });

  it('falls back to the brand id as slug when the brand row is missing', async () => {
    const admin = mockClient({
      brands: { row: null },
      brand_gsc_connections: { count: 1 },
      brand_geo_audits: { count: 1 }
    });
    const steps = await firstSteps(admin, 'brand-1');
    expect(steps[0].href).toBe('/app/brand-1/site');
    expect(steps[0].done).toBe(false);
    expect(steps[1].done).toBe(true);
  });
});
