import { describe, it, expect } from 'vitest';
import { parseCustomAgentSchedule } from './custom-agents';

describe('parseCustomAgentSchedule', () => {
  const base = {
    name: 'Morning review',
    prompt: 'Review pending posts and flag anything off-brand.',
    agent: 'content',
    avatarFace: 'smile',
    avatarColor: '#2563EB',
    days: [1, 2, 3, 4, 5],
    times: ['09:00', '18:30'],
    enabled: 'on',
    reuseThread: 'on'
  };

  it('accepts a full weekday schedule', () => {
    const parsed = parseCustomAgentSchedule(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      name: 'Morning review',
      prompt: base.prompt,
      agent: 'content',
      avatarFace: 'smile',
      avatarColor: '#2563eb',
      daysOfWeek: [1, 2, 3, 4, 5],
      times: ['09:00', '18:30'],
      enabled: true,
      reuseThread: true
    });
  });

  it('maps auto / empty agent to null', () => {
    const a = parseCustomAgentSchedule({ ...base, agent: 'auto' });
    const b = parseCustomAgentSchedule({ ...base, agent: '' });
    expect(a.ok && a.value.agent).toBeNull();
    expect(b.ok && b.value.agent).toBeNull();
  });

  it('rejects empty name, prompt, days, times', () => {
    expect(parseCustomAgentSchedule({ ...base, name: '  ' }).ok).toBe(false);
    expect(parseCustomAgentSchedule({ ...base, prompt: '' }).ok).toBe(false);
    expect(parseCustomAgentSchedule({ ...base, days: [] }).ok).toBe(false);
    expect(parseCustomAgentSchedule({ ...base, times: ['25:00'] }).ok).toBe(false);
  });

  it('falls back to the default avatar when face / colour are missing or bogus', () => {
    const missing = parseCustomAgentSchedule({ ...base, avatarFace: undefined, avatarColor: undefined });
    expect(missing.ok && missing.value.avatarFace).toBe('wide');
    expect(missing.ok && missing.value.avatarColor).toBe('#111111');

    const bogus = parseCustomAgentSchedule({ ...base, avatarFace: 'dragon', avatarColor: 'red' });
    expect(bogus.ok && bogus.value.avatarFace).toBe('wide');
    expect(bogus.ok && bogus.value.avatarColor).toBe('#111111');
  });

  it('dedupes times and pads hours', () => {
    const parsed = parseCustomAgentSchedule({ ...base, times: ['9:00', '09:00', '18:05'] });
    expect(parsed.ok && parsed.value.times).toEqual(['09:00', '18:05']);
  });
});

/**
 * Il tick: un brand non più attivo non deve restare piantato in testa alla coda. La query dei
 * dovuti è `order(next_run_at).limit(40)`, quindi una riga che esce dal giro senza far avanzare
 * next_run_at si ripresenta a ogni tick e ruba il posto alle schedulazioni dei brand vivi.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function tickDb(schedules: Row[], brands: Row[], extra: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    custom_agent_schedules: schedules.map((r) => ({ ...r })),
    brands: brands.map((r) => ({ ...r })),
    ...Object.fromEntries(Object.entries(extra).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]))
  };
  const build = (name: string, mode: 'select' | 'update', patch?: Row) => {
    const filters: Array<(r: Row) => boolean> = [];
    const run = () => {
      const hits = tables[name].filter((r) => filters.every((f) => f(r)));
      if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
      return hits;
    };
    const api: Row = {
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), api),
      order: () => api,
      limit: () => api,
      select: () => api,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res?: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve(res ? res({ data: run(), error: null }) : { data: run(), error: null })
    };
    return api;
  };
  return {
    tables,
    client: {
      from: (name: string) => ({
        select: () => build(name, 'select'),
        update: (patch: Row) => build(name, 'update', patch)
      })
    }
  };
}

describe('tickCustomAgentSchedules', () => {
  it('fa avanzare next_run_at anche per un brand non attivo, invece di lasciarlo in testa', async () => {
    const { tickCustomAgentSchedules } = await import('./custom-agents');
    const past = '2026-08-01T07:00:00.000Z';
    const db = tickDb(
      [
        {
          id: 'sched-1',
          brand_id: 'brand-dead',
          user_id: 'u1',
          prompt: 'go',
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          times: ['09:00'],
          enabled: true,
          next_run_at: past,
          last_error: null
        }
      ],
      [{ id: 'brand-dead', timezone: 'Europe/Rome', status: 'paused' }]
    );

    const res = await tickCustomAgentSchedules(
      db.client as never,
      'https://app.example',
      new Date('2026-08-10T08:00:00.000Z')
    );

    const row = db.tables.custom_agent_schedules[0];
    expect(res.fired).toBe(0);
    expect(res.skipped).toBe(1);
    expect(row.next_run_at).not.toBe(past); // prima restava nel passato, per sempre
    expect(Date.parse(row.next_run_at)).toBeGreaterThan(Date.parse('2026-08-10T08:00:00.000Z'));
    expect(row.last_error).toBe('brand_inactive'); // e ora si vede perché non parte
  });

  // "Senza un piano a pagamento, questi non devono partire" — la regola di scheduledWorkAllowed
  // (job-roster.ts), che qui prima NON esisteva: un brand free poteva schedulare 25 agenti e
  // vederli partire tutti.
  it('brand free e attivo: salta con plan_required, e next_run_at avanza comunque', async () => {
    const { tickCustomAgentSchedules } = await import('./custom-agents');
    const past = '2026-08-01T07:00:00.000Z';
    const db = tickDb(
      [
        {
          id: 'sched-free',
          brand_id: 'brand-free',
          user_id: 'u1',
          prompt: 'go',
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          times: ['09:00'],
          enabled: true,
          next_run_at: past,
          last_error: null
        }
      ],
      [{ id: 'brand-free', timezone: 'Europe/Rome', status: 'active', plan: null }]
    );

    const res = await tickCustomAgentSchedules(
      db.client as never,
      'https://app.example',
      new Date('2026-08-10T08:00:00.000Z')
    );

    const row = db.tables.custom_agent_schedules[0];
    expect(res.fired).toBe(0);
    expect(res.skipped).toBe(1);
    expect(row.last_error).toBe('plan_required'); // la UI lo traduce come "fai l'upgrade", non come guasto
    // Il salto avviene DOPO la CAS: la riga non si accumula in testa alla coda (stesso ordine di brand_inactive).
    expect(Date.parse(row.next_run_at)).toBeGreaterThan(Date.parse('2026-08-10T08:00:00.000Z'));
  });

  it('brand pagante: supera il gate del piano e prova davvero a partire', async () => {
    const { tickCustomAgentSchedules } = await import('./custom-agents');
    const past = '2026-08-01T07:00:00.000Z';
    const db = tickDb(
      [
        {
          id: 'sched-paid',
          brand_id: 'brand-paid',
          user_id: 'u1',
          prompt: 'go',
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          times: ['09:00'],
          enabled: true,
          next_run_at: past,
          // Un run precedente ancora vivo: fireCustomAgentSchedule risponde previous_run_active,
          // che è la PROVA che il gate del piano è stato superato senza dover simulare tutta la coda.
          last_job_id: 'j-prev',
          last_error: null
        }
      ],
      [{ id: 'brand-paid', timezone: 'Europe/Rome', status: 'active', plan: 'starter' }],
      { chat_jobs: [{ id: 'j-prev', status: 'running' }] }
    );

    const res = await tickCustomAgentSchedules(
      db.client as never,
      'https://app.example',
      new Date('2026-08-10T08:00:00.000Z')
    );

    const row = db.tables.custom_agent_schedules[0];
    expect(res.fired).toBe(0);
    expect(row.last_error).toBe('previous_run_active'); // NON plan_required: il piano pagato passa
    expect(res.skipped).toBe(1);
  });
});

/**
 * IL PROPRIETARIO, nella colonna che c'era già. Due cose da tenere ferme:
 *  - un valore col prefisso si CONSERVA (senza, la routine perde il padrone al primo salvataggio);
 *  - un prefisso riconoscibile ma rotto non degrada in "nessun proprietario": diventerebbe un
 *    collega nuovo su una card sua, cioè esattamente quello che l'owner serve a evitare.
 */
describe('parseCustomAgentSchedule — proprietario della routine', () => {
  const base = {
    name: 'Recap del lunedì',
    prompt: 'Leggi le performance e scrivi cosa cambiare.',
    avatarFace: 'smile',
    avatarColor: '#2563EB',
    days: [1],
    times: ['09:00'],
    enabled: 'on',
    reuseThread: ''
  };
  const UUID = '11111111-2222-3333-4444-555555555555';

  it('conserva team:<id> e custom:<uuid> tali e quali', () => {
    const a = parseCustomAgentSchedule({ ...base, agent: 'team:analyst' });
    expect(a.ok && a.value.agent).toBe('team:analyst');
    const b = parseCustomAgentSchedule({ ...base, agent: `custom:${UUID}` });
    expect(b.ok && b.value.agent).toBe(`custom:${UUID}`);
  });

  it('un hub ritirato non è un proprietario: quella card non esiste più', () => {
    // `publish`/`brand`/`grow` erano i vecchi reparti, oggi fusi nei cinque mestieri. Come
    // ESECUTORE resolveAgent li mappa ancora (le righe vecchie continuano a girare); come
    // PROPRIETARIO no — assegnare una routine a un agente che non è sulla pagina la renderebbe
    // invisibile. Il proprietario si scrive solo con gli id vivi, ed è il tool a produrli.
    expect(parseCustomAgentSchedule({ ...base, agent: 'team:publish' }).ok).toBe(false);
    const legacy = parseCustomAgentSchedule({ ...base, agent: 'publish' });
    expect(legacy.ok && legacy.value.agent).toBe('content');
  });

  it('rifiuta un prefisso rotto invece di trattarlo come nessun proprietario', () => {
    expect(parseCustomAgentSchedule({ ...base, agent: 'team:pippo' }).ok).toBe(false);
    expect(parseCustomAgentSchedule({ ...base, agent: 'custom:non-un-uuid' }).ok).toBe(false);
  });

  it('un id nudo resta quello che è sempre stato: chi la esegue, nessun proprietario', () => {
    const a = parseCustomAgentSchedule({ ...base, agent: 'content' });
    expect(a.ok && a.value.agent).toBe('content');
  });
});
