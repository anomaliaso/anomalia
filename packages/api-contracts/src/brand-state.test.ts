import { describe, expect, it } from 'vitest';
import { DIAGNOSE_BRAND } from './brand-state';
import { BRAND_ENDPOINTS } from './index';

const GATE = { id: 'has_active_plan', status: 'fail', detail: 'Nessun piano attivo', fix: 'Approva un piano' };
const LOOP = {
  loop: 'publishing',
  schedule: 'ogni 15 minuti',
  status: 'blocked',
  blockedBy: 'has_active_plan',
  gates: [GATE],
  lastRun: null
};
const DIAGNOSIS = {
  brand: { name: 'Demo Brand', slug: 'demo', plan: 'pro' },
  generatedAt: '2026-09-04T08:00:00Z',
  headline: 'publishing: Nessun piano attivo → Approva un piano',
  loops: [LOOP],
  notCovered: ['seo', 'geo']
};

describe('il contratto dello stato del brand', () => {
  it('espone solo letture: una diagnosi non cura, racconta', () => {
    expect(DIAGNOSE_BRAND.method).toBe('GET');
    expect(DIAGNOSE_BRAND.destructive).toBe(false);
  });

  it('è registrata, o il tool MCP non nasce', () => {
    expect(BRAND_ENDPOINTS).toContain(DIAGNOSE_BRAND);
  });

  it('rifiuta un parametro che non dichiara invece di scartarlo in silenzio', () => {
    expect(DIAGNOSE_BRAND.input.safeParse({ campo_che_non_esiste: 'x' }).success).toBe(false);
  });

  it('non esce di casa: è una lettura del database', () => {
    expect(DIAGNOSE_BRAND.openWorld).toBeUndefined();
  });

  it('la diagnosi dice quale cancello ferma il ciclo, non solo che è fermo', () => {
    expect(DIAGNOSE_BRAND.output.safeParse(DIAGNOSIS).success).toBe(true);
    const { blockedBy: _omitted, ...senzaColpevole } = LOOP;
    expect(DIAGNOSE_BRAND.output.safeParse({ ...DIAGNOSIS, loops: [senzaColpevole] }).success).toBe(false);
  });

  it('un ciclo che gira ha blockedBy a null, e nessun cancello con un rimedio', () => {
    const ok = {
      ...DIAGNOSIS,
      headline: 'Nessun blocco rilevato sui cicli coperti da questa diagnosi.',
      loops: [
        {
          ...LOOP,
          status: 'ok',
          blockedBy: null,
          gates: [{ id: 'has_active_plan', status: 'pass', detail: 'Piano attivo' }],
          lastRun: { at: '2026-09-04T07:00:00Z', outcome: 'published', reason: null }
        }
      ]
    };
    expect(DIAGNOSE_BRAND.output.safeParse(ok).success).toBe(true);
  });

  it('la diagnosi dichiara cosa NON copre, o un "nessun blocco" si legge come "tutto ok"', () => {
    const { notCovered: _omitted, ...senzaPerimetro } = DIAGNOSIS;
    expect(DIAGNOSE_BRAND.output.safeParse(senzaPerimetro).success).toBe(false);
  });
});
