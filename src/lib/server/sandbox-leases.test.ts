import { describe, expect, it, vi } from 'vitest';

import { acquireHolder, releaseHolder } from './sandbox-leases';

type Row = {
  id: string;
  sandbox_name: string;
  holder_key: string;
  kind: string;
  expires_at: string;
};

function fakeDb() {
  const rows: Row[] = [];
  const stop = vi.fn(async () => {});
  let seq = 0;

  const builder = (table: string) => {
    if (table !== 'sandbox_holders') throw new Error(`unexpected table ${table}`);
    const state: { mode: 'upsert' | 'delete' | 'count'; row?: Partial<Row>; id?: string; name?: string; since?: string } = { mode: 'count' };
    const chain = {
      upsert(row: Partial<Row>) {
        state.mode = 'upsert';
        state.row = row;
        return chain;
      },
      delete() {
        state.mode = 'delete';
        return chain;
      },
      eq(column: string, value: string) {
        if (column === 'id') state.id = value;
        if (column === 'sandbox_name') state.name = value;
        return chain;
      },
      gt(column: string, value: string) {
        if (column === 'expires_at') state.since = value;
        return chain;
      },
      select(_columns: string, _opts?: { count?: string; head?: boolean }) {
        return chain;
      },
      async single() {
        seq += 1;
        const key = `${state.row?.sandbox_name}:${state.row?.holder_key}`;
        const existing = rows.find((r) => `${r.sandbox_name}:${r.holder_key}` === key);
        if (existing) {
          existing.expires_at = state.row!.expires_at!;
          return { data: { id: existing.id }, error: null };
        }
        const row: Row = {
          id: `h${seq}`,
          sandbox_name: state.row!.sandbox_name!,
          holder_key: state.row!.holder_key!,
          kind: state.row!.kind!,
          expires_at: state.row!.expires_at!
        };
        rows.push(row);
        return { data: { id: row.id }, error: null };
      },
      async maybeSingle() {
        const i = rows.findIndex((r) => r.id === state.id);
        if (i === -1) return { data: null, error: null };
        const [row] = rows.splice(i, 1);
        return { data: { sandbox_name: row.sandbox_name }, error: null };
      },
      async then(resolve: (v: { count: number | null }) => void) {
        const live = rows.filter(
          (r) => (!state.name || r.sandbox_name === state.name) && (!state.since || r.expires_at > state.since)
        );
        resolve({ count: live.length });
      }
    };
    return chain;
  };

  return { db: { from: builder } as never, rows, stop };
}

const BASE = { name: 'anomalia-vm-g5', brandId: 'b1', kind: 'turn' as const };

describe('acquireHolder', () => {
  it('una seconda acquire con la stessa chiave rinfresca, non duplica', async () => {
    const f = fakeDb();
    const call = { ...BASE, key: 'desktop:ag1', kind: 'desktop' as const, ttlMs: 120_000, db: f.db };
    const first = await acquireHolder(call);
    const second = await acquireHolder(call);
    expect(f.rows).toHaveLength(1);
    expect(second).toBe(first);
  });
});

describe('releaseHolder', () => {
  it("l'ultimo holder che esce spegne la macchina", async () => {
    const f = fakeDb();
    const id = await acquireHolder({ ...BASE, key: 'turn:r1', ttlMs: 60_000, db: f.db });
    
    await releaseHolder(id!, { stop: f.stop }, f.db);
    
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.rows).toHaveLength(0);
  });

  it("due turni simultanei: il primo che esce non ferma la macchina dell'altro", async () => {
    const f = fakeDb();
    const a = await acquireHolder({ ...BASE, key: 'turn:r1', ttlMs: 60_000, db: f.db });
    const b = await acquireHolder({ ...BASE, key: 'turn:r2', ttlMs: 60_000, db: f.db });
    await releaseHolder(a!, { stop: f.stop }, f.db);
    expect(f.stop).not.toHaveBeenCalled();
    await releaseHolder(b!, { stop: f.stop }, f.db);
    expect(f.stop).toHaveBeenCalledTimes(1);
  });

  it('un holder scaduto non tiene accesa la macchina', async () => {
    const f = fakeDb();
    f.rows.push({
      id: 'h9',
      sandbox_name: BASE.name,
      holder_key: 'desktop:ag1',
      kind: 'desktop',
      expires_at: new Date(Date.now() - 60_000).toISOString()
    });
    const id = await acquireHolder({ ...BASE, key: 'turn:r1', ttlMs: 60_000, db: f.db });
    await releaseHolder(id!, { stop: f.stop }, f.db);
    expect(f.stop).toHaveBeenCalledTimes(1);
  });

  it('lo stop fallito non rompe la release', async () => {
    const f = fakeDb();
    f.stop.mockImplementationOnce(async () => {
      throw new Error('stop exploded');
    });
    const id = await acquireHolder({ ...BASE, key: 'turn:r1', ttlMs: 60_000, db: f.db });
    await expect(releaseHolder(id!, { stop: f.stop }, f.db)).resolves.toBeUndefined();
  });

  it('una release senza riga non chiama stop', async () => {
    const f = fakeDb();
    await releaseHolder('inesistente', { stop: f.stop }, f.db);
    expect(f.stop).not.toHaveBeenCalled();
  });
});
