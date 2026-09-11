import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createWriteTools,
  explainWriteError,
  NO_SESSION_WRITE_ERROR,
  UPDATE_MAX_ROWS
} from './write-tool';
import { markRlsScoped } from '$lib/server/rls-client';

vi.mock('$lib/server/ai-log', () => ({ logAiCall: vi.fn() }));

const SRC = readFileSync(new URL('./write-tool.ts', import.meta.url), 'utf8');

type Step = {
  rows?: Array<Record<string, unknown>>;
  count?: number;
  error?: { code: string; message: string; details?: string | null; hint?: string | null };
};

type Recorded = {
  table: string;
  verb: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  filters: string[][];
  head?: boolean;
};

/**
 * PostgREST finto che risponde una cosa DIVERSA a ogni chiamata: un update ne fa due in uno step
 * (il conteggio, poi la scrittura), e un client che sa rispondere una cosa sola non saprebbe
 * distinguere «zero righe corrispondono» da «la scrittura è andata a vuoto».
 */
function fakeClient(script: Step[], opts: { authority?: 'user' | 'service' } = {}) {
  const calls: Recorded[] = [];
  let i = 0;

  const settle = () => {
    const step = script[i++] ?? {};
    return Promise.resolve({
      data: step.error ? null : (step.rows ?? []),
      error: step.error ?? null,
      count: step.count ?? null
    });
  };

  const chain = (rec: Recorded) => {
    calls.push(rec);
    const b: Record<string, unknown> = {};
    b.filter = (c: string, op: string, v: string) => {
      rec.filters.push([c, op, v]);
      return b;
    };
    b.not = (c: string, op: string, v: string) => {
      rec.filters.push(['not', c, op, v]);
      return b;
    };
    b.eq = (c: string, v: string) => {
      rec.filters.push([c, 'eq', v]);
      return b;
    };
    b.select = () => b;
    b.limit = () => b;
    b.abortSignal = () => settle();
    b.then = (resolve: (v: unknown) => unknown) => settle().then(resolve);
    return b;
  };

  const client = {
    from: (table: string) => ({
      select: (_cols: string, options?: { head?: boolean }) =>
        chain({ table, verb: 'select', filters: [], head: options?.head }),
      insert: (payload: Record<string, unknown>) => chain({ table, verb: 'insert', payload, filters: [] }),
      update: (payload: Record<string, unknown>) => chain({ table, verb: 'update', payload, filters: [] })
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { calls, client: opts.authority === 'service' ? client : markRlsScoped(client) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools = (client: any) => createWriteTools({ supabase: client, brandId: 'b1', userId: 'u1', threadId: 't1' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insert = (client: any, input: Record<string, unknown>): Promise<any> => tools(client).insertRow(input as never);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const update = (client: any, input: Record<string, unknown>): Promise<any> => tools(client).updateRow(input as never);

describe('una cancellazione non è rifiutata: è inesprimibile', () => {
  it('il modulo non nomina nessun metodo che cancella o che esegue SQL', () => {
    const body = SRC.slice(SRC.indexOf('export function createWriteTools'));
    for (const m of ['.delete(', '.rpc(', '.upsert(']) {
      expect(body).not.toContain(m);
    }
  });

  it('un nome di tabella che imita SQL non fa partire nessuna richiesta', async () => {
    const { client, calls } = fakeClient([]);
    for (const table of ['posts; delete from posts', 'posts) --', 'rpc/notify_admin_email']) {
      const out = await insert(client, { table, values: { title: 'x' } });
      expect(out.error).toBe('not_an_identifier');
    }
    expect(calls).toHaveLength(0);
  });

  it('una colonna che imita SQL non fa partire nessuna richiesta', async () => {
    const { client, calls } = fakeClient([]);
    const out = await insert(client, { table: 'products', values: { 'title = x; delete from products': 1 } });
    expect(out.error).toBe('not_an_identifier');
    expect(calls).toHaveLength(0);
  });

  it('una tabella che nessuna migrazione crea non parte', async () => {
    const { client, calls } = fakeClient([]);
    const out = await insert(client, { table: 'pg_shadow', values: { x: 1 } });
    expect(out.error).toBe('unknown_table');
    expect(calls).toHaveLength(0);
  });
});

describe('il cancello: senza i permessi dell utente non si scrive', () => {
  it('un client service-role viene respinto e non tocca il database', async () => {
    const { client, calls } = fakeClient([], { authority: 'service' });
    const out = await insert(client, { table: 'products', values: { title: 'x' } });
    expect(out.error).toBe(NO_SESSION_WRITE_ERROR.error);
    expect(calls).toHaveLength(0);
  });

  it('vale identico per update', async () => {
    const { client, calls } = fakeClient([], { authority: 'service' });
    const out = await update(client, {
      table: 'products',
      where: [{ column: 'id', op: 'eq', value: 'p1' }],
      values: { title: 'x' }
    });
    expect(out.error).toBe(NO_SESSION_WRITE_ERROR.error);
    expect(calls).toHaveLength(0);
  });
});

describe('il confine del brand in scrittura: si impone, e uno sbagliato è un rifiuto', () => {
  it('brand_id assente lo mette il server', async () => {
    const { client, calls } = fakeClient([{ rows: [{ id: 'p1' }] }]);
    await insert(client, { table: 'products', values: { title: 'Espresso' } });
    expect(calls[0].payload).toEqual({ title: 'Espresso', brand_id: 'b1' });
  });

  it('il brand_id di un altro NON viene corretto in silenzio: la riga non parte', async () => {
    const { client, calls } = fakeClient([]);
    const out = await insert(client, { table: 'products', values: { title: 'x', brand_id: 'b2' } });
    expect(out.error).toBe('wrong_brand');
    expect(calls).toHaveLength(0);
  });

  it('lo stesso brand esplicito passa, e non si duplica', async () => {
    const { client, calls } = fakeClient([{ rows: [{ id: 'p1' }] }]);
    await insert(client, { table: 'products', values: { title: 'x', brand_id: 'b1' } });
    expect(calls[0].payload).toEqual({ title: 'x', brand_id: 'b1' });
  });

  /**
   * PostgREST NON risponde 42703 a un insert su una colonna che non c'è: risponde PGRST204, che è
   * un'altra cosa e arriva dalla schema cache. Il client finto rispondeva 42703 perché lo diceva
   * il gemello in lettura, e su `profiles` — la prima tabella senza `brand_id` provata davvero —
   * la scrittura moriva con «la colonna brand_id non esiste», che è vero e inutile.
   */
  it.each([
    ['42703', 'column "brand_id" of relation "profiles" does not exist'],
    ['PGRST204', "Could not find the 'brand_id' column of 'profiles' in the schema cache"]
  ])('una tabella senza brand_id si riprova senza (%s)', async (code, message) => {
    const { client, calls } = fakeClient([{ error: { code, message } }, { rows: [{ id: 'u1' }] }]);
    const out = await insert(client, { table: 'profiles', values: { full_name: 'Andrea' } });
    expect(out.error).toBeUndefined();
    expect(calls[1].payload).toEqual({ full_name: 'Andrea' });
  });

  it('update: il filtro sul brand lo aggiunge il server', async () => {
    const { client, calls } = fakeClient([{ count: 1 }, { rows: [{ id: 'p1' }] }]);
    await update(client, {
      table: 'products',
      where: [{ column: 'id', op: 'eq', value: 'p1' }],
      values: { title: 'x' }
    });
    expect(calls[0].filters).toContainEqual(['brand_id', 'eq', 'b1']);
    expect(calls[1].filters).toContainEqual(['brand_id', 'eq', 'b1']);
  });
});

describe('un update senza filtro è la cancellazione appena vietata, travestita', () => {
  it('where vuoto è rifiutato e non tocca il database', async () => {
    const { client, calls } = fakeClient([]);
    const out = await update(client, { table: 'products', where: [], values: { title: 'x' } });
    expect(out.error).toBe('where_required');
    expect(calls).toHaveLength(0);
  });

  it('le righe si contano PRIMA di scrivere, e oltre il tetto non si scrive', async () => {
    const { client, calls } = fakeClient([{ count: UPDATE_MAX_ROWS + 1 }]);
    const out = await update(client, {
      table: 'posts',
      where: [{ column: 'status', op: 'eq', value: 'pending_user' }],
      values: { status: 'approved' }
    });
    expect(out.error).toBe('too_many_rows');
    expect(out.matched).toBe(UPDATE_MAX_ROWS + 1);
    expect(calls.filter((c) => c.verb === 'update')).toHaveLength(0);
  });

  /**
   * Il conteggio NON chiede la testa. Con `head: true` PostgREST non manda un corpo, quindi
   * quando la richiesta fallisce supabase-js consegna un errore senza codice e senza messaggio:
   * `{"error":"db_error","message":""}`. Un update su una tabella senza `brand_id` finiva così —
   * un rifiuto che non dice niente è peggio di uno SQLSTATE nudo, perché nemmeno si riconosce.
   */
  it('il conteggio non chiede la testa: senza corpo sparisce anche il messaggio d errore', async () => {
    const { client, calls } = fakeClient([{ count: 2 }, { rows: [{ id: 'p1' }, { id: 'p2' }] }]);
    await update(client, {
      table: 'products',
      where: [{ column: 'featured', op: 'eq', value: true }],
      values: { featured: false }
    });
    expect(calls[0].verb).toBe('select');
    expect(calls[0].head).not.toBe(true);
  });

  it('un update su una tabella senza brand_id perde il filtro imposto, non il messaggio', async () => {
    const { client, calls } = fakeClient([
      { error: { code: '42703', message: 'column profiles.brand_id does not exist' } },
      { count: 1 },
      { rows: [{ id: 'u1' }] }
    ]);
    const out = await update(client, {
      table: 'profiles',
      where: [{ column: 'id', op: 'eq', value: 'u1' }],
      values: { full_name: 'Andrea' }
    });
    expect(out.error).toBeUndefined();
    expect(calls[2].filters).toEqual([['id', 'eq', 'u1']]);
  });

  /**
   * `negate` esiste nel gemello in lettura, e un filtro che qui non lo capisse selezionerebbe le
   * righe SBAGLIATE per una scrittura: `is null` invece di `is not null` è l'insieme complementare.
   */
  it('negate su un filtro diventa un .not(), non un filtro qualunque', async () => {
    const { client, calls } = fakeClient([{ count: 1 }, { rows: [{ id: 'p1' }] }]);
    await update(client, {
      table: 'posts',
      where: [{ column: 'published_at', op: 'is', value: null, negate: true }],
      values: { status: 'approved' }
    });
    expect(calls[0].filters).toContainEqual(['not', 'published_at', 'is', 'null']);
    expect(calls[1].filters).toContainEqual(['not', 'published_at', 'is', 'null']);
  });

  it('zero righe corrispondenti non è un successo muto', async () => {
    const { client } = fakeClient([{ count: 0 }]);
    const out = await update(client, {
      table: 'products',
      where: [{ column: 'id', op: 'eq', value: 'non-esiste' }],
      values: { title: 'x' }
    });
    expect(out.error).toBe('no_rows_matched');
  });
});

describe('un update parziale tocca solo le colonne inviate', () => {
  it('nel payload finisce quello che il chiamante ha mandato, e nientaltro', async () => {
    const { client, calls } = fakeClient([{ count: 1 }, { rows: [{ id: 'k1' }] }]);
    await update(client, {
      table: 'brand_kit',
      where: [{ column: 'brand_id', op: 'eq', value: 'b1' }],
      values: { category: 'bakery' }
    });
    const write = calls.find((c) => c.verb === 'update');
    expect(write?.payload).toEqual({ category: 'bakery' });
    expect(Object.keys(write?.payload ?? {})).toHaveLength(1);
  });

  it('valori vuoti non sono una scrittura: si rifiuta invece di toccare zero colonne', async () => {
    const { client, calls } = fakeClient([]);
    const out = await update(client, {
      table: 'products',
      where: [{ column: 'id', op: 'eq', value: 'p1' }],
      values: {}
    });
    expect(out.error).toBe('no_values');
    expect(calls).toHaveLength(0);
  });
});

describe('un rifiuto del database torna utilizzabile, non come uno SQLSTATE nudo', () => {
  it('23514 nomina il vincolo E i valori che ammette', () => {
    const fix = explainWriteError(
      '23514',
      'new row for relation "posts" violates check constraint "posts_status_check"',
      null,
      'posts'
    );
    expect(fix).toContain('posts_status_check');
    expect(fix).toContain('pending_user');
    expect(fix).toContain('published');
  });

  it('23505 dice su quale chiave hai colliso e che il rimedio è update_row', () => {
    const fix = explainWriteError(
      '23505',
      'duplicate key value violates unique constraint "products_brand_title_key"',
      'Key (brand_id, title)=(b1, Espresso) already exists.',
      'products'
    );
    expect(fix).toContain('Key (brand_id, title)');
    expect(fix).toContain('update_row');
  });

  it('23505 senza `details` nomina comunque il vincolo: le colonne stanno nel suo nome', () => {
    const fix = explainWriteError(
      '23505',
      'duplicate key value violates unique constraint "brand_news_sources_brand_id_kind_value_key"',
      null,
      'brand_news_sources'
    );
    expect(fix).toContain('brand_news_sources_brand_id_kind_value_key');
    expect(fix).toContain('update_row');
  });

  it('42501 da grant per colonna elenca le colonne davvero scrivibili', () => {
    const fix = explainWriteError('42501', 'permission denied for table organizations', null, 'organizations');
    expect(fix).toContain('name');
    expect(fix).toContain('owner_id');
    expect(fix).not.toContain('row-level');
  });

  it('42501 da RLS non parla di colonne: la riga è di un altro', () => {
    const fix = explainWriteError(
      '42501',
      'new row violates row-level security policy for table "posts"',
      null,
      'posts'
    );
    expect(fix).toContain('RLS');
    expect(fix).not.toContain('Column grants');
  });

  it('23502 nomina la colonna obbligatoria che manca', () => {
    const fix = explainWriteError(
      '23502',
      'null value in column "title" of relation "products" violates not-null constraint',
      null,
      'products'
    );
    expect(fix).toContain('title');
  });
});

describe('una colonna inventata si elenca, non si ritenta', () => {
  it('la scrittura NON si rifà con le colonne vere: solo una lettura si può ritentare', async () => {
    const { client, calls } = fakeClient([
      { error: { code: 'PGRST204', message: "Could not find the 'colour' column of 'products' in the schema cache" } },
      { rows: [{ id: 'p1', title: 'x', pricing: null }] }
    ]);
    const out = await insert(client, { table: 'products', values: { colour: 'red' } });
    expect(out.error).toBe('PGRST204');
    expect(out.columns_available).toEqual(['id', 'title', 'pricing']);
    expect(calls.filter((c) => c.verb === 'insert')).toHaveLength(1);
  });
});

describe('il registro dei vincoli e dei grant si genera, non si batte a mano', () => {
  it('rigenerato dalle migrazioni dà lo stesso file', () => {
    const generated = new URL('../../../../packages/api-contracts/src/write-rules.ts', import.meta.url);
    const before = readFileSync(generated, 'utf8');
    execFileSync('node', ['scripts/query-tables-from-migrations.mjs', '--write'], {
      cwd: new URL('../../../../', import.meta.url).pathname
    });
    expect(readFileSync(generated, 'utf8')).toBe(before);
  });
});
