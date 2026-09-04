import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

import { GET, POST } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { AGENT_MEMORY_CATEGORIES, MEMORY_CATEGORIES, MEMORY_ENTRIES_MAX } from '@anomalia/api-contracts';
import { MEMORY_CATEGORY_VALUES } from '$lib/server/brand-memory';

type Row = Record<string, unknown>;

/** Il filtro `.is('agent', null)` di `scopeToAgent` e `.neq('layer','session')` sono quelli veri. */
function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const all = (tables[table] ??= []);
      let rows = [...all];
      const q = {
        select: () => q,
        eq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] === value);
          return q;
        },
        neq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] !== value);
          return q;
        },
        is(column: string, value: unknown) {
          rows = rows.filter((r) => (r[column] ?? null) === value);
          return q;
        },
        or: () => q,
        order: () => q,
        limit(n: number) {
          rows = rows.slice(0, n);
          return q;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        insert(row: Row) {
          all.push({ id: `new-${all.length}`, ...row });
          return {
            select: () => ({
              single: async () => ({ data: all[all.length - 1], error: null }),
              maybeSingle: async () => ({ data: all[all.length - 1], error: null })
            })
          };
        },
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null })
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null })
  };
}

const entry = (over: Row = {}): Row => ({
  id: 'm1',
  brand_id: 'brand-1',
  layer: 'project',
  category: 'fact',
  key: 'spedizione',
  value: 'Gratuita sopra i 50 euro',
  source: 'user',
  confidence: 1,
  times_reinforced: 0,
  times_used: 2,
  last_used_at: null,
  last_reinforced_at: null,
  expires_at: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  pinned: false,
  agent: null,
  ...over
});

let tables: Record<string, Row[]>;

function signedIn(rows: Row[] = []) {
  tables = { brand_memory: rows };
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(tables),
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo', name: 'Demo Brand' },
    error: null
  } as never);
}

function get(query: Record<string, string> = {}, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/memory`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return (GET as (e: unknown) => Promise<Response>)({
    request: new Request(url),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

function post(payload: Record<string, unknown>, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/memory`);
  return (POST as (e: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(payload) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /memory', () => {
  it('non restituisce la memoria di un altro brand, nemmeno con la stessa chiave', async () => {
    signedIn([
      entry(),
      entry({ id: 'm2', brand_id: 'brand-2', key: 'spedizione', value: 'Il vicino spedisce a 9 euro' })
    ]);

    const { res, body } = await get();

    expect(res.status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('Il vicino spedisce');
  });

  it('non fa uscire la chiacchiera di una chat: la memoria di sessione resta nel suo thread', async () => {
    signedIn([entry(), entry({ id: 'm2', layer: 'session', key: 'estemporanea', value: 'forse domani' })]);

    const { body } = await get();

    expect(body.entries.map((e: { key: string }) => e.key)).toEqual(['spedizione']);
  });

  it('non fa uscire le note di mestiere di un agente: solo la memoria del brand', async () => {
    signedIn([entry(), entry({ id: 'm2', agent: 'motion', key: 'nota-di-motion' })]);

    const { body } = await get();

    expect(body.entries.map((e: { key: string }) => e.key)).toEqual(['spedizione']);
  });

  /** IL `GET` RESTA PURO: leggere non è usare, e questo non è un `ensureReferralCode`. */
  it('leggere non conta come usare: nessuna scrittura parte da una lettura', async () => {
    signedIn([entry()]);

    await get();

    expect(tables.brand_memory[0].times_used).toBe(2);
    expect(tables.brand_memory[0].last_used_at).toBeNull();
  });

  it('restringe a una categoria, e rifiuta una inventata', async () => {
    signedIn([entry(), entry({ id: 'm2', category: 'insight', key: 'osservazione' })]);

    const only = await get({ category: 'insight' });
    expect(only.body.entries.map((e: { key: string }) => e.key)).toEqual(['osservazione']);

    const bad = await get({ category: 'inventata' });
    expect(bad.res.status).toBe(400);
    expect(bad.body.error).toBe('unknown_category');
  });

  it('applica il tetto invece di rovesciare mille righe', async () => {
    signedIn(Array.from({ length: MEMORY_ENTRIES_MAX + 40 }, (_, i) => entry({ id: `m${i}`, key: `k${i}` })));

    const { body } = await get({ limit: '999' });

    expect(body.entries).toHaveLength(MEMORY_ENTRIES_MAX);
  });
});

describe('POST /memory', () => {
  it('rifiuta voice e constraint: riscrivere la voce è un cambio di marca in una chiamata', async () => {
    signedIn();

    for (const category of ['voice', 'constraint']) {
      const { res, body } = await post({ key: 'tono', value: 'sempre in maiuscolo', category });
      expect(res.status, category).toBe(403);
      expect(body.error, category).toBe('category_not_writable');
    }

    expect(tables.brand_memory).toHaveLength(0);
  });

  it('accetta quello che un agente impara lavorando', async () => {
    signedIn();

    for (const category of AGENT_MEMORY_CATEGORIES) {
      const { res } = await post({ key: `k-${category}`, value: `v-${category}`, category });
      expect(res.status, category).toBe(200);
    }

    expect(tables.brand_memory).toHaveLength(AGENT_MEMORY_CATEGORIES.length);
  });

  it('un fatto scritto da un agente non arriva con la certezza di uno scritto a mano', async () => {
    signedIn();

    await post({ key: 'sede', value: 'Milano', category: 'fact' });

    const written = tables.brand_memory[0];
    expect(written.source).toBe('chat');
    expect(written.confidence as number).toBeLessThan(1);
  });

  /** L'ULTIMO ARRIVATO NON VINCE. Il conflitto torna con entrambi i valori e non scrive niente. */
  it('un valore che contraddice quello che c’è risponde 409 con tutti e due, e non sovrascrive', async () => {
    signedIn([entry({ key: 'spedizione', value: 'Gratuita sopra i 50 euro' })]);

    const { res, body } = await post({
      key: 'spedizione',
      value: 'Costa sempre 7 euro',
      category: 'fact'
    });

    expect(res.status).toBe(409);
    expect(body.error).toBe('memory_conflict');
    expect(body.conflict.existing.value).toBe('Gratuita sopra i 50 euro');
    expect(body.conflict.incoming.value).toBe('Costa sempre 7 euro');
    expect(tables.brand_memory[0].value).toBe('Gratuita sopra i 50 euro');
  });

  it('ripetere lo stesso valore non è un conflitto: è un rinforzo', async () => {
    signedIn([entry({ key: 'spedizione', value: 'Gratuita sopra i 50 euro' })]);

    const { res } = await post({
      key: 'spedizione',
      value: 'Gratuita sopra i 50 euro',
      category: 'fact'
    });

    expect(res.status).toBe(200);
  });

  it('non scrive mai nel layer di sessione: fuori non esiste un thread', async () => {
    signedIn();

    await post({ key: 'k', value: 'v', category: 'insight', layer: 'session', thread_id: 't1' });

    expect(tables.brand_memory[0].layer).toBe('project');
  });

  it('le categorie dichiarate nel contratto sono quelle che il database accetta', () => {
    expect([...MEMORY_CATEGORIES].sort()).toEqual([...MEMORY_CATEGORY_VALUES].sort());
  });

  it('chiede chiave, valore e categoria invece di indovinarli', async () => {
    signedIn();

    for (const payload of [{ value: 'v', category: 'fact' }, { key: 'k', category: 'fact' }, { key: 'k', value: 'v' }]) {
      const { res } = await post(payload);
      expect(res.status).toBe(400);
    }
  });
});
