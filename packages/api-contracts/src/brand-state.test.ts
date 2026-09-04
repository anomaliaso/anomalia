import { describe, expect, it } from 'vitest';
import { DIAGNOSE_BRAND, GET_GOALS, GOALS_MAX } from './brand-state';
import { BRAND_ENDPOINTS } from './index';

const BRAND_STATE = [DIAGNOSE_BRAND, GET_GOALS];

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
    for (const endpoint of BRAND_STATE) {
      expect(endpoint.method, endpoint.tool).toBe('GET');
      expect(endpoint.destructive, endpoint.tool).toBe(false);
    }
  });

  it('è registrato, o il tool MCP non nasce', () => {
    for (const endpoint of BRAND_STATE) {
      expect(BRAND_ENDPOINTS, endpoint.tool).toContain(endpoint);
    }
  });

  it('rifiuta un parametro che non dichiara invece di scartarlo in silenzio', () => {
    for (const endpoint of BRAND_STATE) {
      expect(endpoint.input.safeParse({ campo_che_non_esiste: 'x' }).success, endpoint.tool).toBe(false);
    }
  });

  it('nessuna delle due esce di casa: sono due letture del database', () => {
    for (const endpoint of BRAND_STATE) {
      expect(endpoint.openWorld, endpoint.tool).toBeUndefined();
    }
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

  it('gli obiettivi dichiarano il tetto che la rotta applica in silenzio', () => {
    expect(GET_GOALS.input.safeParse({ limit: GOALS_MAX }).success).toBe(true);
    expect(GET_GOALS.input.safeParse({ limit: GOALS_MAX + 1 }).success).toBe(false);
    expect(GET_GOALS.input.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('gli obiettivi si filtrano per conversazione, e il parametro si chiama come nella query', () => {
    expect(GET_GOALS.input.safeParse({ thread: 'th-1' }).success).toBe(true);
    expect(GET_GOALS.input.safeParse({ threadId: 'th-1' }).success).toBe(false);
  });

  it('il riepilogo degli obiettivi risponde a "funziona?", non a "quanti sono"', () => {
    const summary = {
      goals: 3,
      open: 1,
      met: 1,
      handed_back: 1,
      abandoned: 0,
      met_first_pass: 1,
      laps: 2,
      stopped_by: { out_of_time: 1 },
      criteria_done: 4,
      criteria_dropped: 1,
      criteria_open: 2
    };
    const goal = {
      id: 'g-1',
      statement: 'Pubblica tre post',
      status: 'met',
      source: 'user',
      laps: 0,
      criteria: [{ id: 'c1', text: 'primo post', status: 'done', note: null }],
      created_at: '2026-09-01T08:00:00Z',
      closed_at: '2026-09-01T09:00:00Z',
      closing_note: null,
      events: [
        { kind: 'opened', reason: null, actor: 'user', progress: '0/1', closed_now: 0, laps: 0, queued: null, at: '2026-09-01T08:00:00Z' }
      ]
    };
    expect(GET_GOALS.output.safeParse({ brand: 'demo', summary, goals: [goal] }).success).toBe(true);

    const { met_first_pass: _omitted, ...senzaPrimoColpo } = summary;
    expect(GET_GOALS.output.safeParse({ brand: 'demo', summary: senzaPrimoColpo, goals: [] }).success).toBe(false);
    expect(
      GET_GOALS.output.safeParse({ brand: 'demo', summary, goals: [{ ...goal, status: 'boh' }] }).success
    ).toBe(false);
  });
});
