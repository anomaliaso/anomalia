import { describe, expect, it, vi } from 'vitest';
import { ensureDemoUser, ensureOrg, ensureBrand, ensurePrivileges } from './db-seed.mjs';

describe('ensureDemoUser', () => {
  it('returns the id from a successful admin create', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'user-1' })
    }));
    const user = await ensureDemoUser('http://gotrue', 'key', 'demo@example.com', 'pw', fetchImpl as any);
    expect(user).toEqual({ id: 'user-1', created: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to listing users when create fails (already exists) — idempotent', async () => {
    const fetchImpl = vi
      .fn()
      // create fails
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'already exists' })
      // page 1 has the user
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ users: [{ id: 'user-1', email: 'demo@example.com' }] })
      });
    const user = await ensureDemoUser('http://gotrue', 'key', 'demo@example.com', 'pw', fetchImpl as any);
    expect(user).toEqual({ id: 'user-1', created: false });
  });

  it('throws with the create error when the user cannot be found either', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'boom', text: async () => 'boom' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [] }) });
    await expect(
      ensureDemoUser('http://gotrue', 'key', 'demo@example.com', 'pw', fetchImpl as any)
    ).rejects.toThrow('demo@example.com');
  });
});

function fakeClient(existingOrgRow: { id: string } | null) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('select id from organizations')) {
        return { rows: existingOrgRow ? [existingOrgRow] : [] };
      }
      if (sql.startsWith('insert into organizations')) {
        return { rows: [{ id: 'new-org' }] };
      }
      if (sql.startsWith('insert into brands')) {
        return { rows: [{ id: 'brand-1' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

describe('ensureOrg', () => {
  it('reuses an existing org for the owner instead of inserting a new one', async () => {
    const client = fakeClient({ id: 'existing-org' });
    const id = await ensureOrg(client as any, 'owner-1', 'Demo Org');
    expect(id).toBe('existing-org');
    expect(client.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });

  it('inserts when the owner has no org yet', async () => {
    const client = fakeClient(null);
    const id = await ensureOrg(client as any, 'owner-1', 'Demo Org');
    expect(id).toBe('new-org');
  });
});

describe('ensureBrand', () => {
  it('upserts on the (org_id, slug) conflict target', async () => {
    const client = fakeClient(null);
    const id = await ensureBrand(client as any, 'org-1', 'demo', 'Demo Brand', 'https://example.com');
    expect(id).toBe('brand-1');
    expect(client.calls[0].sql).toContain('on conflict (org_id, slug)');
  });

  it('seeds an active paid brand — plan=null would make accountLimit() 0 and bounce the connect', async () => {
    const client = fakeClient(null);
    await ensureBrand(client as any, 'org-1', 'demo', 'Demo Brand', 'https://example.com');
    expect(client.calls[0].params).toEqual([
      'org-1',
      'demo',
      'Demo Brand',
      'https://example.com',
      'pro',
      'active'
    ]);
    // ...but a re-seed must not rewrite them on an instance already in use.
    expect(client.calls[0].sql).toContain('do update set name = excluded.name, website = excluded.website');
  });
});

describe('ensurePrivileges', () => {
  it('runs every grant idempotently and survives a restricted statement without failing the seed', async () => {
    const executed: string[] = [];
    const client = {
      query: async (sql: string) => {
        executed.push(sql);
        if (sql.startsWith('alter default privileges in schema public grant usage')) {
          throw new Error('must be owner of …');
        }
        return { rows: [] };
      }
    };
    await expect(ensurePrivileges(client as any)).resolves.toBeUndefined();
    const tables = executed.filter((s) => s.startsWith('grant') && s.includes('on all tables'));
    expect(tables.some((s) => s.includes('to anon'))).toBe(true);
    expect(tables.some((s) => s.includes('to authenticated'))).toBe(true);
    expect(executed.some((s) => s.startsWith('grant execute on all functions'))).toBe(true);
  });
});
