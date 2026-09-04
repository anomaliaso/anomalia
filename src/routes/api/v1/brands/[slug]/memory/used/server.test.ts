import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { MEMORY_USED_MAX } from '@anomalia/api-contracts';

type Row = Record<string, unknown>;

let bumped: string[][];
let owned: Row[];

function fakeSupabase() {
  return {
    from() {
      let rows = [...owned];
      const q = {
        select: () => q,
        eq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] === value);
          return q;
        },
        in(column: string, values: unknown[]) {
          rows = rows.filter((r) => values.includes(r[column]));
          return q;
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null })
      };
      return q;
    },
    rpc: async (_fn: string, args: { entry_ids: string[] }) => {
      bumped.push(args.entry_ids);
      return { data: null, error: null };
    }
  };
}

function signedIn(rows: Row[] = [{ id: 'm1', brand_id: 'brand-1' }, { id: 'm2', brand_id: 'brand-1' }]) {
  bumped = [];
  owned = rows;
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(),
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo', name: 'Demo Brand' },
    error: null
  } as never);
}

function post(payload: Record<string, unknown>, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/memory/used`);
  return (POST as (e: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(payload) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /memory/used', () => {
  it('segnala l’uso delle voci indicate', async () => {
    signedIn();

    const { res, body } = await post({ ids: ['m1', 'm2'] });

    expect(res.status).toBe(200);
    expect(body.counted).toBe(2);
    expect(bumped).toEqual([['m1', 'm2']]);
  });

  /**
   * Il contatore alimenta il decadimento in `runDream`: un id di un altro brand che passasse di
   * qui terrebbe viva la memoria del vicino, o peggio la userebbe come sonda per scoprire che
   * esiste. Le righe si filtrano PRIMA di contarle.
   */
  it('non conta l’uso di una voce di un altro brand, e non ammette di averla vista', async () => {
    signedIn([{ id: 'm1', brand_id: 'brand-1' }]);

    const { res, body } = await post({ ids: ['m1', 'm-del-vicino'] });

    expect(res.status).toBe(200);
    expect(body.counted).toBe(1);
    expect(bumped).toEqual([['m1']]);
    expect(JSON.stringify(body)).not.toContain('m-del-vicino');
  });

  it('un elenco di soli id estranei non scrive niente', async () => {
    signedIn([]);

    const { body } = await post({ ids: ['x1', 'x2'] });

    expect(body.counted).toBe(0);
    expect(bumped).toEqual([]);
  });

  it('rifiuta un elenco vuoto invece di fingere di aver contato', async () => {
    signedIn();

    const { res, body } = await post({ ids: [] });

    expect(res.status).toBe(400);
    expect(body.error).toBe('ids_required');
  });

  it('applica il tetto invece di accettare un elenco qualunque', async () => {
    signedIn();

    const { res, body } = await post({ ids: Array.from({ length: MEMORY_USED_MAX + 1 }, (_, i) => `m${i}`) });

    expect(res.status).toBe(400);
    expect(body.error).toBe('too_many_ids');
  });
});
