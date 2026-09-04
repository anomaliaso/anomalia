import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => ({}) }));

const roster = vi.fn();
const runs = vi.fn();
const toggle = vi.fn();

vi.mock('$lib/server/job-roster', async (original) => {
  const actual = await original<typeof import('$lib/server/job-roster')>();
  return {
    ...actual,
    brandRoster: (...args: unknown[]) => roster(...args),
    jobRunCounts: (...args: unknown[]) => runs(...args),
    setJobEnabled: (...args: unknown[]) => toggle(...args)
  };
});

import { GET, PUT } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

const ROW = {
  key: 'seo',
  cadence: 'weekly',
  enabled: true,
  state: 'ok',
  reason: null,
  lastRunAt: '2026-09-01T00:00:00.000Z',
  servedAt: '2026-09-01T00:00:00.000Z',
  behind: false
};

const BRAND = { id: 'brand-1', slug: 'demo', plan: 'pro' };

const url = 'https://example.test/api/v1/brands/demo/settings/automations';

const read = () =>
  (GET as (e: unknown) => Promise<Response>)({ request: new Request(url), params: { slug: 'demo' } });

const write = (body: unknown) =>
  (PUT as (e: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'PUT', body: JSON.stringify(body) }),
    params: { slug: 'demo' }
  });

beforeEach(() => {
  vi.clearAllMocks();
  roster.mockResolvedValue([ROW]);
  runs.mockResolvedValue(new Map([['seo', 4]]));
  toggle.mockResolvedValue({ ok: true });
  vi.mocked(authenticate).mockResolvedValue({ supabase: {}, user: { id: 'u1' }, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: BRAND, error: null } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(null as never);
});

describe('GET /api/v1/brands/:slug/settings/automations', () => {
  it('dice di ogni lavoro cosa fa, ogni quanto, e quante volte ha girato', async () => {
    const body = await (await read()).json();

    expect(body.jobs[0]).toMatchObject({
      job: 'seo',
      cadence: 'weekly',
      enabled: true,
      state: 'ok',
      runs_30d: 4
    });
    expect(body.jobs[0].what).toContain('SEO');
  });

  it('un lavoro che non ha mai girato vale zero, non manca', async () => {
    runs.mockResolvedValue(new Map());

    const body = await (await read()).json();

    expect(body.jobs[0].runs_30d).toBe(0);
  });

  it('guarda indietro trenta giorni, non da sempre', async () => {
    await read();

    const since = Date.parse(runs.mock.calls[0][2] as string);
    const days = (Date.now() - since) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('dice se su questo piano i lavori partono, invece di lasciarlo indovinare', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: { ...BRAND, plan: 'free' },
      error: null
    } as never);

    const body = await (await read()).json();

    expect(body.scheduled_work_allowed).toBe(false);
  });

  it('non chiama nessun modello e non spende', async () => {
    await read();

    expect(toggle).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/brands/:slug/settings/automations', () => {
  it('accende il lavoro chiesto e riscrive cosa è stato impegnato', async () => {
    const res = await write({ job: 'seo', enabled: true });

    expect(res.status).toBe(200);
    expect(toggle).toHaveBeenCalledWith({}, { brandId: 'brand-1', jobKey: 'seo', enabled: true, userId: 'u1' });
    expect(await res.json()).toEqual({
      ok: true,
      job: 'seo',
      enabled: true,
      cadence: 'weekly',
      spends_on_every_run: true,
      scheduled_work_allowed: true
    });
  });

  it('spegnere non impegna niente, e lo dice', async () => {
    const body = await (await write({ job: 'seo', enabled: false })).json();

    expect(body.enabled).toBe(false);
    expect(body.spends_on_every_run).toBe(false);
  });

  it('rifiuta un lavoro che non esiste, invece di scrivere un opt-out orfano', async () => {
    const res = await write({ job: 'chat', enabled: true });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_input');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('rifiuta una richiesta che non dice se accendere o spegnere', async () => {
    const res = await write({ job: 'seo' });

    expect(res.status).toBe(400);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('si ferma prima di scrivere se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(new Response('read only', { status: 403 }) as never);

    const res = await write({ job: 'seo', enabled: true });

    expect(res.status).toBe(403);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('si ferma prima di scrivere se il brand non è del chiamante', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: null,
      error: new Response('not found', { status: 404 })
    } as never);

    const res = await write({ job: 'seo', enabled: true });

    expect(res.status).toBe(404);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('riporta il fallimento dell interruttore come il 500 dichiarato', async () => {
    toggle.mockResolvedValue({ ok: false, error: 'db' });

    const res = await write({ job: 'seo', enabled: true });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('toggle_failed');
  });
});
