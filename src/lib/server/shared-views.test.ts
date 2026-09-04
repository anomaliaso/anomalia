import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getCalendar = vi.fn();
vi.mock('./cli-queries', () => ({ getCalendar: (...args: unknown[]) => getCalendar(...args) }));

import { SHARED_VIEW_TYPES } from '@anomalia/api-contracts';
import {
  CALENDAR_POST_FIELDS,
  CALENDAR_SNAPSHOT_FIELDS,
  DASHBOARD_SNAPSHOT_FIELDS,
  REPORT_POST_FIELDS,
  REPORT_SNAPSHOT_FIELDS,
  SHARE_SNAPSHOT_VERSION,
  STRATEGY_GOAL_FIELDS,
  STRATEGY_PHASE_FIELDS,
  STRATEGY_PLATFORM_FIELDS,
  STRATEGY_SNAPSHOT_FIELDS,
  WORKSPACE_SNAPSHOT_FIELDS,
  STRATEGY_WEEK_FIELDS,
  SharedViewsNotMigrated,
  buildSnapshot,
  createSharedView,
  hashShareToken,
  listSharedViews,
  mintShareToken,
  readSharedView,
  revokeSharedView
} from './shared-views';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

const BRAND = { id: 'brand-1', name: 'Demo Brand', timezone: 'Europe/Rome', content_prefs: { language: 'it' } };
const MISSING_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.shared_views' in the schema cache" };

function fakeTable(result: Result | (() => Result)) {
  const calls: { method: string; args: unknown[] }[] = [];
  const q: Row = { calls };
  for (const method of ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'lt', 'gt', 'is', 'or', 'order', 'limit', 'insert', 'update']) {
    q[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return q;
    };
  }
  const settle = async () => (typeof result === 'function' ? result() : result);
  q.single = settle;
  q.maybeSingle = settle;
  q.then = (onOk: (v: Result) => unknown, onErr?: (e: unknown) => unknown) => settle().then(onOk, onErr);
  return q as Row & { calls: { method: string; args: unknown[] }[] };
}

function fakeSupabase(tables: Record<string, ReturnType<typeof fakeTable>>) {
  return {
    tables,
    from: (name: string) => tables[name] ?? fakeTable({ data: null, error: null })
  } as never;
}

function argsOf(table: ReturnType<typeof fakeTable>, method: string) {
  return table.calls.filter((c) => c.method === method).map((c) => c.args);
}

const A_POST_ROW_WITH_EVERYTHING = {
  id: 'post-1',
  brand_id: 'brand-1',
  platform: 'linkedin',
  caption: 'Copy che il cliente può leggere',
  media_url: 'https://cdn.test/a.png',
  scheduled_for: '2026-09-10T07:00:00.000Z',
  slot: '2026-09-10',
  status: 'approved',
  image_prompt: 'un prompt interno',
  qc: { verdict: 'borderline' },
  approval_token: 'token-di-approvazione',
  attention_reason: 'nota interna',
  design: { layers: [] },
  plan_id: 'plan-1'
};

const A_HISTORY_ROW_WITH_EVERYTHING = {
  id: 'history-1',
  brand_id: 'brand-1',
  source: 'zernio',
  platform: 'instagram',
  content: 'Il post pubblicato',
  platform_post_url: 'https://instagram.com/p/abc',
  thumbnail_url: 'https://cdn.test/t.jpg',
  thumbnail_path: 'brand-knowledge/brand-1/t.jpg',
  published_at: '2026-09-04T10:00:00.000Z',
  zernio_external_post_id: 'zzz-1',
  metrics: { views: 1000, likes: 50, comments: 4, shares: 2, saves: 9, impressions: 1200 }
};

function calendarReturns(posts: Row[]) {
  getCalendar.mockResolvedValue({
    posts,
    year: 2026,
    month: 9,
    monthLabel: 'settembre 2026',
    prevYM: '2026-08',
    nextYM: '2026-10',
    timezone: 'Europe/Rome'
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calendarReturns([A_POST_ROW_WITH_EVERYTHING]);
});

describe('il token di una vista condivisa', () => {
  it('è opaco, ad alta entropia e non si ripete', () => {
    const a = mintShareToken();
    const b = mintShareToken();

    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.token_hash).not.toBe(b.token_hash);
  });

  it('non è ricavabile dall impronta che il database conserva', () => {
    const { token, token_hash } = mintShareToken();

    expect(token_hash).not.toContain(token);
    expect(token_hash).toBe(hashShareToken(token));
    expect(hashShareToken(`${token}x`)).not.toBe(token_hash);
  });
});

describe('creare una vista condivisa', () => {
  it('restituisce il token una volta sola e scrive solo la sua impronta', async () => {
    const shares = fakeTable({ data: { id: 'share-1' }, error: null });
    const created = await createSharedView(fakeSupabase({ shared_views: shares }), {
      brand: BRAND,
      authorId: 'user-1',
      view: 'calendar',
      month: '2026-09'
    });

    const [[written]] = argsOf(shares, 'insert') as [[Row]];
    expect(JSON.stringify(written)).not.toContain(created.token);
    expect(written.token_hash).toBe(hashShareToken(created.token));
    expect(Object.keys(written)).not.toContain('token');
    expect(written.brand_id).toBe('brand-1');
    expect(written.author_id).toBe('user-1');
    expect(written.snapshot_version).toBe(SHARE_SNAPSHOT_VERSION);
  });

  it('senza scadenza dichiarata il link non scade, con una la porta scritta', async () => {
    const shares = fakeTable({ data: { id: 'share-1' }, error: null });
    const supabase = fakeSupabase({ shared_views: shares });

    await createSharedView(supabase, { brand: BRAND, authorId: 'user-1', view: 'calendar', month: '2026-09' });
    await createSharedView(supabase, {
      brand: BRAND,
      authorId: 'user-1',
      view: 'calendar',
      month: '2026-09',
      expiresInDays: 7
    });

    const [[first], [second]] = argsOf(shares, 'insert') as [[Row], [Row]];
    expect(first.expires_at).toBeNull();
    expect(typeof second.expires_at).toBe('string');
    expect(Date.parse(second.expires_at as string)).toBeGreaterThan(Date.now());
  });

  it('dice che la migration manca invece di far passare un errore Postgres', async () => {
    const shares = fakeTable({ data: null, error: MISSING_TABLE });

    await expect(
      createSharedView(fakeSupabase({ shared_views: shares }), {
        brand: BRAND,
        authorId: 'user-1',
        view: 'calendar',
        month: '2026-09'
      })
    ).rejects.toBeInstanceOf(SharedViewsNotMigrated);
  });
});

describe('lo snapshot del calendario', () => {
  it('porta solo i campi dichiarati, anche se il post ne ha trenta', async () => {
    const { snapshot } = await buildSnapshot(fakeSupabase({}), BRAND, 'calendar', '2026-09');

    expect(Object.keys(snapshot).sort()).toEqual([...CALENDAR_SNAPSHOT_FIELDS].sort());
    expect(Object.keys((snapshot.posts as Row[])[0]).sort()).toEqual([...CALENDAR_POST_FIELDS].sort());
  });

  it('non fa uscire prompt, qc, note interne o identificatori privati', async () => {
    const { snapshot } = await buildSnapshot(fakeSupabase({}), BRAND, 'calendar', '2026-09');
    const serialized = JSON.stringify(snapshot);

    for (const secret of ['un prompt interno', 'borderline', 'token-di-approvazione', 'nota interna', 'post-1', 'brand-1', 'plan-1']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('mostra al cliente uno stato suo, non il workflow interno', async () => {
    calendarReturns([
      { ...A_POST_ROW_WITH_EVERYTHING, status: 'pending_user' },
      { ...A_POST_ROW_WITH_EVERYTHING, status: 'failed', scheduled_for: '2026-09-11T07:00:00.000Z' },
      { ...A_POST_ROW_WITH_EVERYTHING, status: 'published', scheduled_for: '2026-09-12T07:00:00.000Z' }
    ]);

    const { snapshot } = await buildSnapshot(fakeSupabase({}), BRAND, 'calendar', '2026-09');

    expect((snapshot.posts as Row[]).map((p) => p.status)).toEqual(['planned', 'planned', 'published']);
  });

  it('lascia fuori le bozze senza data: un calendario è fatto di giorni', async () => {
    calendarReturns([
      { ...A_POST_ROW_WITH_EVERYTHING, scheduled_for: null, slot: null, isDraft: true },
      A_POST_ROW_WITH_EVERYTHING
    ]);

    const { snapshot } = await buildSnapshot(fakeSupabase({}), BRAND, 'calendar', '2026-09');

    expect((snapshot.posts as Row[]).length).toBe(1);
  });
});

describe('lo snapshot del report mensile', () => {
  function reportSupabase(rows: Row[]) {
    return fakeSupabase({ social_post_history: fakeTable({ data: rows, error: null }) });
  }

  it('porta solo i campi dichiarati, in cima e su ogni post', async () => {
    const { snapshot } = await buildSnapshot(reportSupabase([A_HISTORY_ROW_WITH_EVERYTHING]), BRAND, 'monthly_report', '2026-09');

    expect(Object.keys(snapshot).sort()).toEqual([...REPORT_SNAPSHOT_FIELDS].sort());
    expect(Object.keys((snapshot.top_posts as Row[])[0]).sort()).toEqual([...REPORT_POST_FIELDS].sort());
  });

  it('non fa uscire identificatori privati né la provenienza dei dati', async () => {
    const { snapshot } = await buildSnapshot(reportSupabase([A_HISTORY_ROW_WITH_EVERYTHING]), BRAND, 'monthly_report', '2026-09');
    const serialized = JSON.stringify(snapshot);

    for (const secret of ['history-1', 'brand-1', 'zernio', 'zzz-1', 'brand-knowledge']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('somma il mese chiesto e lo chiede al database, non tutta la storia', async () => {
    const history = fakeTable({ data: [A_HISTORY_ROW_WITH_EVERYTHING], error: null });
    const { snapshot } = await buildSnapshot(fakeSupabase({ social_post_history: history }), BRAND, 'monthly_report', '2026-09');

    expect(snapshot.totals).toEqual({ views: 1000, likes: 50, comments: 4, shares: 2 });
    expect(snapshot.published).toBe(1);
    expect(argsOf(history, 'eq')).toContainEqual(['brand_id', 'brand-1']);
    expect(argsOf(history, 'gte')[0][0]).toBe('published_at');
    expect(argsOf(history, 'lt')[0][0]).toBe('published_at');
  });
});

describe('lo snapshot della dashboard', () => {
  function dashboardSupabase(rows: Row[]) {
    return fakeSupabase({ social_post_history: fakeTable({ data: rows, error: null }) });
  }

  it('porta solo i campi dichiarati, in cima e su ogni uscita', async () => {
    const { snapshot } = await buildSnapshot(dashboardSupabase([A_HISTORY_ROW_WITH_EVERYTHING]), BRAND, 'dashboard', '2026-09');

    expect(Object.keys(snapshot).sort()).toEqual([...DASHBOARD_SNAPSHOT_FIELDS].sort());
    expect(Object.keys((snapshot.upcoming as Row[])[0]).sort()).toEqual([...CALENDAR_POST_FIELDS].sort());
  });

  it('non fa uscire prompt, qc, note interne o identificatori privati', async () => {
    const { snapshot } = await buildSnapshot(dashboardSupabase([A_HISTORY_ROW_WITH_EVERYTHING]), BRAND, 'dashboard', '2026-09');
    const serialized = JSON.stringify(snapshot);

    for (const secret of ['un prompt interno', 'borderline', 'token-di-approvazione', 'nota interna', 'post-1', 'brand-1', 'plan-1', 'zernio']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('conta le tre cifre che il cliente legge: uscite fatte, uscite in programma, copertura', async () => {
    calendarReturns([
      { ...A_POST_ROW_WITH_EVERYTHING, status: 'approved', scheduled_for: '2026-09-10T07:00:00.000Z' },
      { ...A_POST_ROW_WITH_EVERYTHING, status: 'pending_user', scheduled_for: '2026-09-11T07:00:00.000Z' },
      { ...A_POST_ROW_WITH_EVERYTHING, status: 'published', scheduled_for: '2026-09-01T07:00:00.000Z' }
    ]);

    const { snapshot } = await buildSnapshot(dashboardSupabase([A_HISTORY_ROW_WITH_EVERYTHING]), BRAND, 'dashboard', '2026-09');

    expect(snapshot.published).toBe(1);
    expect(snapshot.planned).toBe(2);
    expect(snapshot.reach).toBe(1000);
  });

  it('tiene fuori dalle prossime uscite quelle gia pubblicate', async () => {
    calendarReturns([
      { ...A_POST_ROW_WITH_EVERYTHING, status: 'published', scheduled_for: '2026-09-01T07:00:00.000Z' },
      { ...A_POST_ROW_WITH_EVERYTHING, status: 'approved', scheduled_for: '2026-09-10T07:00:00.000Z' }
    ]);

    const { snapshot } = await buildSnapshot(dashboardSupabase([]), BRAND, 'dashboard', '2026-09');

    expect((snapshot.upcoming as Row[]).map((p) => p.status)).toEqual(['planned']);
  });
});

describe('la tabella dei tipi di vista', () => {
  it('ogni vista che il contratto dichiara sa costruire il proprio snapshot', async () => {
    for (const view of SHARED_VIEW_TYPES) {
      const supabase = fakeSupabase({ social_post_history: fakeTable({ data: [], error: null }) });
      const { snapshot, version } = await buildSnapshot(supabase, BRAND, view, '2026-09');

      expect(version, view).toBe(SHARE_SNAPSHOT_VERSION);
      expect(snapshot.month, view).toBe('2026-09');
      expect(snapshot.brand_name, view).toBe('Demo Brand');
    }
  });
});

describe('leggere una vista condivisa dal token', () => {
  const LIVE = {
    view_type: 'calendar',
    snapshot: { brand_name: 'Demo Brand', posts: [] },
    snapshot_version: 1,
    created_at: '2026-09-01T00:00:00.000Z',
    expires_at: null,
    revoked_at: null
  };

  function readWith(row: Row | null) {
    const shares = fakeTable({ data: row, error: null });
    return readSharedView(fakeSupabase({ shared_views: shares }), 'un-token-qualunque');
  }

  it('restituisce lo snapshot per un token valido', async () => {
    await expect(readWith(LIVE)).resolves.toEqual({
      view: 'calendar',
      version: 1,
      snapshot: LIVE.snapshot,
      created_at: LIVE.created_at
    });
  });

  it('revocato, scaduto e mai esistito sono la stessa risposta', async () => {
    const results = await Promise.all([
      readWith({ ...LIVE, revoked_at: '2026-09-02T00:00:00.000Z' }),
      readWith({ ...LIVE, expires_at: '2026-09-02T00:00:00.000Z' }),
      readWith(null)
    ]);

    expect(results).toEqual([null, null, null]);
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it('cerca per impronta: il token in chiaro non arriva mai al database', async () => {
    const shares = fakeTable({ data: null, error: null });
    await readSharedView(fakeSupabase({ shared_views: shares }), 'un-token-qualunque');

    const filters = argsOf(shares, 'eq');
    expect(filters).toEqual([['token_hash', hashShareToken('un-token-qualunque')]]);
    expect(JSON.stringify(filters)).not.toContain('un-token-qualunque');
  });

  it('non legge nessuna tabella viva: lo snapshot è tutto quello che esce', async () => {
    const tables: string[] = [];
    const shares = fakeTable({ data: LIVE, error: null });
    await readSharedView(
      { from: (name: string) => (tables.push(name), shares) } as never,
      'un-token-qualunque'
    );

    expect(tables).toEqual(['shared_views']);
  });
});

describe('la lista e la revoca', () => {
  it('elenca solo il brand chiesto e non mostra mai l impronta del token', async () => {
    const shares = fakeTable({
      data: [
        {
          id: 'share-1',
          view_type: 'calendar',
          snapshot_version: 1,
          created_at: '2026-09-01T00:00:00.000Z',
          expires_at: null,
          revoked_at: null,
          snapshot: { month: '2026-09' }
        }
      ],
      error: null
    });

    const list = await listSharedViews(fakeSupabase({ shared_views: shares }), 'brand-1');

    expect(argsOf(shares, 'eq')).toEqual([['brand_id', 'brand-1']]);
    expect(JSON.stringify(argsOf(shares, 'select'))).not.toContain('token_hash');
    expect(JSON.stringify(list)).not.toContain('token_hash');
    expect(Object.keys(list[0]).sort()).toEqual(
      ['created_at', 'expires_at', 'id', 'month', 'revoked_at', 'status', 'view'].sort()
    );
  });

  it('la revoca tocca solo la riga di quel brand', async () => {
    const shares = fakeTable({ data: { id: 'share-1', revoked_at: '2026-09-04T00:00:00.000Z' }, error: null });

    const revoked = await revokeSharedView(fakeSupabase({ shared_views: shares }), 'brand-1', 'share-1');

    expect(argsOf(shares, 'eq')).toEqual([
      ['id', 'share-1'],
      ['brand_id', 'brand-1']
    ]);
    expect(revoked).toEqual({ id: 'share-1', revoked_at: '2026-09-04T00:00:00.000Z' });
  });

  it('una share di un altro brand non si revoca: non risulta', async () => {
    const shares = fakeTable({ data: null, error: null });

    await expect(revokeSharedView(fakeSupabase({ shared_views: shares }), 'brand-1', 'share-di-un-altro')).resolves.toBeNull();
  });
});

describe('lo snapshot della strategia', () => {
  const AN_EDITORIAL_PLAN_WITH_EVERYTHING = {
    id: 'plan-1',
    brand_id: 'brand-1',
    status: 'active',
    strategy: 'La strategia che il cliente legge',
    cadence: '3/week',
    platform_mix: [{ platform: 'linkedin', share: '60%', role: 'autorità' }],
    weeks: [
      {
        index: 0,
        week_start: '2026-09-07',
        theme: 'Lancio',
        focus: 'Presentare il prodotto',
        status: 'planned',
        rationale: 'ragionamento interno',
        brief: 'il brief che ha scritto l operatore',
        products: ['SKU interno'],
        content_mix: [{ type: 'reel', count: 3 }]
      }
    ],
    voice: { mood: 'interno', tone: 'interno', goal: 'interno', personality: 'interno' },
    revision_feedback: 'il feedback della revisione',
    changes_summary: ['cambio interno'],
    source: 'agent',
    parent_id: 'plan-0'
  };

  const A_GTM_PLAN_WITH_EVERYTHING = {
    id: 'gtm-1',
    brand_id: 'brand-1',
    status: 'active',
    horizon: '6m',
    objective: 'Vendere di più',
    phases: [
      {
        index: 0,
        name: 'Fase passata',
        objective: 'passato',
        rationale: 'ragionamento interno gtm',
        start_date: '2026-06-01',
        end_date: '2026-08-31',
        goals: [{ kpi: 'lead', target: '100', why: 'perché interno', actual: '42', metric: 'leads', value: 42 }],
        platform_weights: [{ platform: 'linkedin', percent: 100 }],
        pillars: ['pilastro']
      },
      {
        index: 1,
        name: 'Fase corrente',
        objective: 'crescere',
        rationale: 'ragionamento interno gtm',
        start_date: '2026-09-01',
        end_date: '2026-11-30',
        goals: [{ kpi: 'lead', target: '200', why: 'perché interno', actual: '10', metric: 'leads', value: 10 }],
        platform_weights: [{ platform: 'linkedin', percent: 100 }],
        pillars: ['pilastro']
      }
    ],
    revision_feedback: 'il feedback della revisione gtm',
    reply: 'risposta interna',
    changes_summary: ['cambio interno gtm'],
    parent_id: 'gtm-0'
  };

  function strategySupabase(editorial: Row | null, gtm: Row | null) {
    return fakeSupabase({
      editorial_plans: fakeTable({ data: editorial, error: null }),
      gtm_plans: fakeTable({ data: gtm, error: null })
    });
  }

  it('porta solo i campi dichiarati, in cima e dentro ogni parte', async () => {
    const { snapshot } = await buildSnapshot(
      strategySupabase(AN_EDITORIAL_PLAN_WITH_EVERYTHING, A_GTM_PLAN_WITH_EVERYTHING),
      BRAND,
      'strategy',
      '2026-09'
    );

    expect(Object.keys(snapshot).sort()).toEqual([...STRATEGY_SNAPSHOT_FIELDS].sort());
    expect(Object.keys((snapshot.weeks as Row[])[0]).sort()).toEqual([...STRATEGY_WEEK_FIELDS].sort());
    expect(Object.keys((snapshot.platforms as Row[])[0]).sort()).toEqual([...STRATEGY_PLATFORM_FIELDS].sort());
    expect(Object.keys(snapshot.phase as Row).sort()).toEqual([...STRATEGY_PHASE_FIELDS].sort());
    expect(Object.keys(((snapshot.phase as Row).goals as Row[])[0]).sort()).toEqual([...STRATEGY_GOAL_FIELDS].sort());
  });

  it('non fa uscire brief, revisioni, ragionamenti interni né identificatori', async () => {
    const { snapshot } = await buildSnapshot(
      strategySupabase(AN_EDITORIAL_PLAN_WITH_EVERYTHING, A_GTM_PLAN_WITH_EVERYTHING),
      BRAND,
      'strategy',
      '2026-09'
    );
    const serialized = JSON.stringify(snapshot);

    for (const secret of [
      'ragionamento interno',
      'il brief che ha scritto l operatore',
      'SKU interno',
      'il feedback della revisione',
      'cambio interno',
      'risposta interna',
      'perché interno',
      'plan-1',
      'plan-0',
      'gtm-1',
      'gtm-0',
      'brand-1'
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it('legge solo il piano attivo: una proposta non è lavoro concordato', async () => {
    const editorial = fakeTable({ data: AN_EDITORIAL_PLAN_WITH_EVERYTHING, error: null });
    const gtm = fakeTable({ data: A_GTM_PLAN_WITH_EVERYTHING, error: null });

    await buildSnapshot(fakeSupabase({ editorial_plans: editorial, gtm_plans: gtm }), BRAND, 'strategy', '2026-09');

    expect(argsOf(editorial, 'eq')).toEqual([
      ['brand_id', 'brand-1'],
      ['status', 'active']
    ]);
    expect(argsOf(gtm, 'eq')).toEqual([
      ['brand_id', 'brand-1'],
      ['status', 'active']
    ]);
  });

  it('mostra la fase che governa il mese chiesto, non la prima della lista', async () => {
    const { snapshot } = await buildSnapshot(
      strategySupabase(AN_EDITORIAL_PLAN_WITH_EVERYTHING, A_GTM_PLAN_WITH_EVERYTHING),
      BRAND,
      'strategy',
      '2026-09'
    );

    expect((snapshot.phase as Row).name).toBe('Fase corrente');
  });

  it('senza piano attivo resta vuoto invece di rompersi', async () => {
    const { snapshot } = await buildSnapshot(strategySupabase(null, null), BRAND, 'strategy', '2026-09');

    expect(snapshot.statement).toBeNull();
    expect(snapshot.weeks).toEqual([]);
    expect(snapshot.platforms).toEqual([]);
    expect(snapshot.phase).toBeNull();
    expect(Object.keys(snapshot).sort()).toEqual([...STRATEGY_SNAPSHOT_FIELDS].sort());
  });

  it('dice che la migration manca invece di far passare un errore Postgres', async () => {
    const supabase = fakeSupabase({ editorial_plans: fakeTable({ data: null, error: MISSING_TABLE }) });

    await expect(buildSnapshot(supabase, BRAND, 'strategy', '2026-09')).rejects.toBeInstanceOf(SharedViewsNotMigrated);
  });
});

describe('lo snapshot del workspace', () => {
  function workspaceSupabase() {
    return fakeSupabase({
      social_post_history: fakeTable({ data: [A_HISTORY_ROW_WITH_EVERYTHING], error: null }),
      editorial_plans: fakeTable({ data: null, error: null }),
      gtm_plans: fakeTable({ data: null, error: null })
    });
  }

  it('porta solo i campi dichiarati in cima', async () => {
    const { snapshot } = await buildSnapshot(workspaceSupabase(), BRAND, 'workspace', '2026-09');

    expect(Object.keys(snapshot).sort()).toEqual([...WORKSPACE_SNAPSHOT_FIELDS].sort());
  });

  it('ogni sezione è esattamente lo snapshot della sua vista: non può mostrare di più', async () => {
    const { snapshot } = await buildSnapshot(workspaceSupabase(), BRAND, 'workspace', '2026-09');

    expect(Object.keys(snapshot.calendar as Row).sort()).toEqual([...CALENDAR_SNAPSHOT_FIELDS].sort());
    expect(Object.keys(snapshot.report as Row).sort()).toEqual([...REPORT_SNAPSHOT_FIELDS].sort());
    expect(Object.keys(snapshot.dashboard as Row).sort()).toEqual([...DASHBOARD_SNAPSHOT_FIELDS].sort());
    expect(Object.keys(snapshot.strategy as Row).sort()).toEqual([...STRATEGY_SNAPSHOT_FIELDS].sort());
  });

  it('non fa uscire prompt, qc, note interne o identificatori privati', async () => {
    const { snapshot } = await buildSnapshot(workspaceSupabase(), BRAND, 'workspace', '2026-09');
    const serialized = JSON.stringify(snapshot);

    for (const secret of ['un prompt interno', 'borderline', 'token-di-approvazione', 'nota interna', 'post-1', 'brand-1', 'plan-1', 'zernio']) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it('non ripete le query: il calendario e la storia si leggono una volta sola', async () => {
    const history = fakeTable({ data: [A_HISTORY_ROW_WITH_EVERYTHING], error: null });
    await buildSnapshot(
      fakeSupabase({
        social_post_history: history,
        editorial_plans: fakeTable({ data: null, error: null }),
        gtm_plans: fakeTable({ data: null, error: null })
      }),
      BRAND,
      'workspace',
      '2026-09'
    );

    expect(getCalendar).toHaveBeenCalledTimes(1);
    expect(argsOf(history, 'select').length).toBe(1);
  });
});

// Le porte che una pagina aggiunta domani deve attraversare per diventare pubblica. Sono
// deliberate e separate: il contratto, il builder, il vincolo SQL, la superficie pubblica.
// Questi test tengono le ultime due allineate alla prima — l'unica che TypeScript non copre.
describe('l elenco di ciò che è pubblico non si allarga da solo', () => {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

  it('il vincolo SQL su view_type dice esattamente quello che dice il contratto', () => {
    const dir = join(repoRoot, 'supabase/migrations');
    const declared = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .flatMap((name) => [...readFileSync(join(dir, name), 'utf8').matchAll(/view_type\s+in\s*\(([^)]*)\)/g)])
      .at(-1);

    expect(declared, 'nessuna migration dichiara i tipi di shared_views').toBeTruthy();

    const allowed = [...(declared as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed.sort()).toEqual([...SHARED_VIEW_TYPES].sort());
  });

  it('sotto /share vive una rotta sola: il token, e niente altro', () => {
    expect(readdirSync(join(repoRoot, 'src/routes/share'))).toEqual(['[token]']);
  });
});
