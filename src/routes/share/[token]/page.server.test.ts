import { describe, it, expect, vi, beforeEach } from 'vitest';

const adminResult: { data: unknown; error: unknown } = { data: null, error: null };
const readTables: string[] = [];

vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      readTables.push(table);
      const q: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'or', 'order', 'limit']) q[method] = () => q;
      q.maybeSingle = async () => adminResult;
      return q;
    }
  })
}));

import { load } from './+page.server';

const SNAPSHOT = {
  brand_name: 'Demo Brand',
  timezone: 'Europe/Rome',
  month: '2026-09',
  month_label: 'settembre 2026',
  posts: [{ platform: 'linkedin', caption: 'copy', media_url: null, scheduled_for: '2026-09-10T07:00:00.000Z', slot: null, status: 'planned' }]
};

const LIVE_ROW = {
  view_type: 'calendar',
  snapshot: SNAPSHOT,
  snapshot_version: 1,
  created_at: '2026-09-01T00:00:00.000Z',
  expires_at: null,
  revoked_at: null
};

function anonymousEvent(token: string) {
  const safeGetSession = vi.fn();
  return {
    event: { params: { token }, locals: { safeGetSession, supabase: null } },
    safeGetSession
  };
}

async function loadWith(row: unknown, token = 'un-token-qualunque') {
  adminResult.data = row;
  adminResult.error = null;
  readTables.length = 0;
  const { event, safeGetSession } = anonymousEvent(token);
  try {
    return { ok: true as const, data: await (load as (e: unknown) => Promise<unknown>)(event), safeGetSession };
  } catch (thrown) {
    return { ok: false as const, thrown, safeGetSession };
  }
}

beforeEach(() => {
  readTables.length = 0;
});

describe('GET /share/:token', () => {
  it('mostra lo snapshot congelato per un token valido', async () => {
    const result = await loadWith(LIVE_ROW);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual({
      view: 'calendar',
      version: 1,
      snapshot: SNAPSHOT,
      created_at: '2026-09-01T00:00:00.000Z'
    });
  });

  it('non legge nessuna tabella viva: solo la riga della share', async () => {
    await loadWith(LIVE_ROW);

    expect(readTables).toEqual(['shared_views']);
  });

  it('non chiede mai chi sta guardando', async () => {
    const valid = await loadWith(LIVE_ROW);
    const missing = await loadWith(null);

    expect(valid.safeGetSession).not.toHaveBeenCalled();
    expect(missing.safeGetSession).not.toHaveBeenCalled();
  });

  it('revocato, scaduto e mai esistito rispondono nello stesso identico modo', async () => {
    const revoked = await loadWith({ ...LIVE_ROW, revoked_at: '2026-09-02T00:00:00.000Z' });
    const expired = await loadWith({ ...LIVE_ROW, expires_at: '2026-09-02T00:00:00.000Z' });
    const never = await loadWith(null);

    for (const result of [revoked, expired, never]) {
      expect(result.ok).toBe(false);
    }

    const shapes = [revoked, expired, never].map((r) =>
      JSON.stringify({
        status: (r.thrown as { status: number }).status,
        body: (r.thrown as { body: unknown }).body
      })
    );
    expect(new Set(shapes).size).toBe(1);
    expect((revoked.thrown as { status: number }).status).toBe(404);
  });

  it('non nomina il brand quando il link non vale', async () => {
    const { thrown } = await loadWith({ ...LIVE_ROW, revoked_at: '2026-09-02T00:00:00.000Z' });

    expect(JSON.stringify(thrown)).not.toContain('Demo Brand');
    expect(JSON.stringify(thrown)).not.toContain('revoked');
  });

  it('se la tabella manca lo dice come guasto del server, non come link inesistente', async () => {
    adminResult.data = null;
    adminResult.error = { code: 'PGRST205', message: "Could not find the table 'public.shared_views' in the schema cache" };
    const { event } = anonymousEvent('un-token-qualunque');

    await expect((load as (e: unknown) => Promise<unknown>)(event)).rejects.toMatchObject({ status: 500 });
  });
});
