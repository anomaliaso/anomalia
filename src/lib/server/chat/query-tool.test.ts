import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createQueryTool,
  explainDbError,
  DB_STATEMENT_TIMEOUT_MS,
  NO_SESSION_ERROR,
  QUERY_MAX_CHARS,
  QUERY_MAX_VALUE_CHARS,
  QUERY_MAX_ROWS,
  QUERY_TABLE_LIST
} from './query-tool';

vi.mock('$lib/server/ai-log', () => ({ logAiCall: vi.fn() }));
import { logAiCall } from '$lib/server/ai-log';

/**
 * Un client finto che si comporta come PostgREST: registra COSA gli è stato chiesto (per poter
 * dimostrare che certe chiamate non partono mai) e restituisce quel che gli si dice.
 */
function fakeClient(opts: {
  session?: { access_token: string } | null;
  rows?: Array<Record<string, unknown>>;
  count?: number;
  error?: { code: string; message: string; hint?: string | null; details?: string | null };
}) {
  const calls: Array<{ table: string; cols: string; filters: string[][]; limit?: number }> = [];
  const builder = (table: string, cols: string) => {
    const rec = { table, cols, filters: [] as string[][], limit: undefined as number | undefined };
    calls.push(rec);
    const b: Record<string, unknown> = {};
    b.filter = (c: string, op: string, v: string) => {
      rec.filters.push([c, op, v]);
      return b;
    };
    b.order = () => b;
    b.limit = (n: number) => {
      rec.limit = n;
      return b;
    };
    b.abortSignal = () =>
      Promise.resolve({ data: opts.error ? null : (opts.rows ?? []), error: opts.error ?? null, count: opts.count ?? null });
    return b;
  };
  return {
    calls,
    client: {
      auth: { getSession: async () => ({ data: { session: opts.session === undefined ? { access_token: 'jwt' } : opts.session } }) },
      from: (table: string) => ({ select: (cols: string) => builder(table, cols) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (client: any, input: Record<string, unknown>): Promise<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (createQueryTool({ supabase: client, brandId: 'b1', userId: 'u1', threadId: 't1' }).query as any).execute(input, {});

const SRC = readFileSync(new URL('./query-tool.ts', import.meta.url), 'utf8');

describe('sola lettura: le scritture non sono rifiutate, sono inesprimibili', () => {
  // Le tre forme che il proprietario ha nominato — quelle che un filtro su "insert" NON prende.
  it.each([
    ['CTE che scrive', 'posts; with q as (insert into posts values (1)) select * from q'],
    ['select … into', 'posts) select 1 into admins --'],
    ['funzione security definer', 'rpc/notify_admin_email']
  ])('%s non parte nemmeno come richiesta', async (_label, table) => {
    const { client, calls } = fakeClient({});
    const out = await run(client, { table });
    expect(out.error).toBe('not_an_identifier');
    // La prova che conta: zero richieste di rete. Non è stato analizzato dell'SQL — non c'è SQL.
    expect(calls).toHaveLength(0);
  });

  it('rifiuta anche colonna, filtro e ordinamento non-identificatori', async () => {
    const { client, calls } = fakeClient({});
    for (const input of [
      { table: 'posts', columns: ['id, (with q as (insert into x values(1)) select 1)'] },
      { table: 'posts', where: [{ column: 'id) or 1=1 --', op: 'eq', value: 1 }] },
      { table: 'posts', order: { column: 'id; drop table posts' } }
    ]) {
      const out = await run(client, input);
      expect(out.error).toBe('not_an_identifier');
    }
    expect(calls).toHaveLength(0);
  });

  it('il modulo non nomina nessun metodo di scrittura — il tetto vive nel codice, non nella testa', () => {
    const body = SRC.slice(SRC.indexOf('export function createQueryTool'));
    for (const m of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      expect(body).not.toContain(m);
    }
  });

  it('una lettura legittima invece parte, e passa da .select()', async () => {
    const { client, calls } = fakeClient({ rows: [{ id: 'p1' }], count: 1 });
    const out = await run(client, {
      table: 'posts',
      columns: ['id'],
      where: [{ column: 'brand_id', op: 'eq', value: 'b1' }],
      limit: 5
    });
    expect(out.rows).toEqual([{ id: 'p1' }]);
    expect(calls[0]).toMatchObject({ table: 'posts', cols: 'id', limit: 5 });
    expect(calls[0].filters).toEqual([['brand_id', 'eq', 'b1']]);
  });
});

describe('il cancello: senza sessione utente non si legge', () => {
  it('un client service-role (nessuna sessione) viene respinto, e non tocca il database', async () => {
    const { client, calls } = fakeClient({ session: null, rows: [{ id: 'segreto-di-un-altro-brand' }] });
    const out = await run(client, { table: 'posts' });
    expect(out.error).toBe('no_user_session');
    expect(out).not.toHaveProperty('rows');
    expect(calls).toHaveLength(0);
  });

  it('il rifiuto spiega che la service role scavalcherebbe la RLS', () => {
    expect(NO_SESSION_ERROR.message).toMatch(/RLS/);
    expect(NO_SESSION_ERROR.message).toMatch(/service-role/);
  });
});

describe('i tetti sono dichiarati, mai silenziosi', () => {
  it('dice quante righe su quante, e come restringere', async () => {
    const { client } = fakeClient({ rows: Array.from({ length: 20 }, (_, i) => ({ id: i })), count: 1043 });
    const out = await run(client, { table: 'posts' });
    expect(out.returned).toBe(20);
    expect(out.total).toBe(1043);
    expect(out.limits).toContain('20 rows of ~1043');
    expect(out.limits).toMatch(/where|limit/);
  });

  it('non si superano MAX_ROWS nemmeno chiedendolo', async () => {
    const { client, calls } = fakeClient({ rows: [], count: 0 });
    await run(client, { table: 'posts', limit: 9999 });
    expect(calls[0].limit).toBe(QUERY_MAX_ROWS);
  });

  it('il taglio sui caratteri è per riga intera E viene dichiarato', async () => {
    // Ogni valore sta SOTTO il tetto per-valore (1.900 < 2.000): quello che morde qui è il tetto
    // per riga, e le due cose vanno viste separate o un test copre il buco dell'altro.
    const big = 'x'.repeat(1_900);
    const { client } = fakeClient({ rows: Array.from({ length: 20 }, (_, i) => ({ id: i, body: big })), count: 20 });
    const out = await run(client, { table: 'brand_documents' });
    expect(out.returned).toBeLessThan(20);
    expect(JSON.stringify(out.rows).length).toBeLessThanOrEqual(QUERY_MAX_CHARS + 200);
    expect(out.limits).toContain(`Cut at ${QUERY_MAX_CHARS} chars`);
    // Righe intere: nessuna riga mutilata, e nessun valore toccato dal tetto per-valore.
    for (const r of out.rows) expect(String(r.body)).toHaveLength(1_900);
    expect(out.limits).not.toContain('Values cut at');
  });

  it('una riga sola da 726.007 caratteri non entra intera, e il campo tagliato viene nominato', async () => {
    // Il caso vero: brand_documents.content. La prima riga si prende sempre (o `select *` su quella
    // tabella non tornerebbe MAI niente e la scoperta delle colonne morirebbe lì), quindi il tetto
    // per riga da solo non la ferma. Deve fermarla il tetto sul valore.
    const monstre = 'y'.repeat(726_007);
    const { client } = fakeClient({ rows: [{ id: 'd1', title: 'corto', content: monstre }], count: 1 });
    const out = await run(client, { table: 'brand_documents' });
    expect(out.returned).toBe(1);
    expect(JSON.stringify(out.rows).length).toBeLessThan(QUERY_MAX_CHARS);
    // La scoperta delle colonne sopravvive: ci sono ancora tutte e tre le chiavi.
    expect(Object.keys(out.rows[0]).sort()).toEqual(['content', 'id', 'title']);
    // E il taglio è dichiarato PER NOME, o il modello crederebbe di avere il testo intero.
    expect(out.limits).toContain('content');
    expect(out.limits).toContain(String(QUERY_MAX_VALUE_CHARS));
    expect(out.limits).toMatch(/NOT seeing those fields in full/);
    expect(String(out.rows[0].content)).toContain('726007 chars total');
    // Il campo corto resta intatto: si taglia ciò che sfonda, non tutto.
    expect(out.rows[0].title).toBe('corto');
  });

  it('taglia anche un jsonb enorme, non solo le stringhe', async () => {
    const { client } = fakeClient({ rows: [{ id: 1, blob: { k: 'z'.repeat(50_000) } }], count: 1 });
    const out = await run(client, { table: 'posts' });
    expect(out.limits).toContain('blob');
    expect(JSON.stringify(out.rows).length).toBeLessThan(QUERY_MAX_CHARS);
  });

  it('dichiara che il totale è una stima quando lo è', async () => {
    const { client } = fakeClient({ rows: [{ id: 1 }], count: 50_000 });
    const out = await run(client, { table: 'posts' });
    expect(out.limits).toContain('estimate');
  });
});

describe("l'errore insegna", () => {
  it('timeout del database: nomina il tetto vero e cosa fare', async () => {
    const { client } = fakeClient({ error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    const out = await run(client, { table: 'brand_doc_chunks' });
    expect(out.error).toBe('57014');
    expect(out.fix).toContain(`${DB_STATEMENT_TIMEOUT_MS / 1000}s`);
    expect(out.fix).toMatch(/where filter|lower the limit/);
  });

  it('tabella sbagliata: passa il suggerimento di PostgREST e dice come si scopre lo schema', async () => {
    const { client } = fakeClient({
      error: { code: 'PGRST205', message: "Could not find the table 'public.postz'", hint: "Perhaps you meant the table 'public.posts'" }
    });
    const out = await run(client, { table: 'postz' });
    expect(out.fix).toContain("Perhaps you meant the table 'public.posts'");
    expect(out.fix).toContain('no table');
  });

  it('colonna sbagliata e RLS negata portano entrambe un rimedio, non solo il messaggio SQL', () => {
    expect(explainDbError('42703', 'column x does not exist')).toMatch(/keys ARE the column list/);
    expect(explainDbError('42501', 'permission denied')).toMatch(/member of/);
    expect(explainDbError('PGRST200', 'no relationship')).toMatch(/ONE table at a time/);
  });
});

describe('scoperta dello schema', () => {
  it('senza tabella elenca le tabelle, e dichiara che la lista può invecchiare', async () => {
    const { client, calls } = fakeClient({});
    const out = await run(client, {});
    expect(out.count).toBe(QUERY_TABLE_LIST.length);
    expect(out.tables).toContain('posts');
    expect(out.note).toMatch(/lag/);
    expect(calls).toHaveLength(0);
  });

  it('la lista non sta nella descrizione del tool — si paga solo quando serve', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desc = (createQueryTool({ supabase: fakeClient({}).client, brandId: 'b1' }).query as any).description as string;
    expect(desc).not.toContain('brand_doc_chunks');
    expect(desc.length).toBeLessThan(2_000);
    // Ma dice come si scopre, e dichiara i tetti al modello.
    expect(desc).toMatch(/no `table`/);
    expect(desc).toContain(String(QUERY_MAX_ROWS));
    expect(desc).toContain(`${DB_STATEMENT_TIMEOUT_MS / 1000}s`);
  });

  it('la descrizione porta il brand_id di questo turno, così il filtro è copiabile', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desc = (createQueryTool({ supabase: fakeClient({}).client, brandId: 'brand-xyz' }).query as any).description as string;
    expect(desc).toContain('brand-xyz');
  });
});

describe('il registro', () => {
  it('registra ogni lettura riuscita con query, righe e durata', async () => {
    vi.mocked(logAiCall).mockClear();
    const { client } = fakeClient({ rows: [{ id: 1 }], count: 7 });
    await run(client, { table: 'posts', columns: ['id'], where: [{ column: 'brand_id', op: 'eq', value: 'b1' }] });
    const entry = vi.mocked(logAiCall).mock.calls[0][0];
    expect(entry.label).toBe('db_query');
    expect(entry.provider).toBe('internal');
    expect(entry.ok).toBe(true);
    expect(entry.context).toContain('posts');
    expect(entry.context).toContain('rows=1/7');
    expect(entry.brandId).toBe('b1');
    expect(entry.threadId).toBe('t1');
    expect(typeof entry.ms).toBe('number');
  });

  it("registra anche i rifiuti — è l'errore che ha reso invisibile sandbox_exec", async () => {
    for (const [input, session] of [
      [{ table: 'posts' }, null],
      [{ table: 'posts; insert into x' }, undefined]
    ] as const) {
      vi.mocked(logAiCall).mockClear();
      const { client } = fakeClient({ session });
      await run(client, input as Record<string, unknown>);
      const entry = vi.mocked(logAiCall).mock.calls[0][0];
      expect(entry.ok).toBe(false);
      expect(entry.context).toContain('refused');
    }
  });
});

describe('il confine del brand e imposto, non raccomandato', () => {
  it('senza un filtro su brand_id lo aggiunge il server', async () => {
    const f = fakeClient({});
    await run(f.client, { table: 'posts' });
    const filtri = f.calls.flatMap((c) => c.filters);
    expect(filtri, 'il server deve imporre brand_id anche se il modello non lo chiede').toContainEqual([
      'brand_id',
      'eq',
      'b1'
    ]);
  });

  it('se il modello filtra gia su brand_id, non lo si duplica', async () => {
    const f = fakeClient({});
    await run(f.client, { table: 'posts', where: [{ column: 'brand_id', op: 'eq', value: 'b1' }] });
    const suBrand = f.calls.flatMap((c) => c.filters).filter((x) => x[0] === 'brand_id');
    expect(suBrand).toHaveLength(1);
  });

  it('una chiave sconosciuta e un errore, non un silenzio', () => {
    // Il difetto vero: il modello passo `filters:` invece di `where:`, zod la scarto senza dire
    // niente, la lettura divento «tutte le righe» e il tool rispose ok — 18 bozze invece di 2,
    // cioe la somma di TUTTI i brand dell utente.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schema = (createQueryTool({ supabase: fakeClient({}).client, brandId: 'b1' }).query as any).inputSchema;
    expect(schema.safeParse({ table: 'posts', filters: { status: 'pending_user' } }).success).toBe(false);
    expect(schema.safeParse({ table: 'posts', where: [{ column: 'status', op: 'eq', value: 'x' }] }).success).toBe(true);
  });
});

/**
 * Un client finto che risponde DIVERSAMENTE a ogni chiamata: serve perché il rimedio al 42703 fa
 * tre GET in uno step (lettura fallita → sonda dello schema → rilettura), e `fakeClient` sa
 * rispondere una cosa sola.
 */
function scriptedClient(
  script: Array<{ rows?: Array<Record<string, unknown>>; error?: { code: string; message: string } }>
) {
  const calls: Array<{ table: string; cols: string; filters: string[][]; limit?: number }> = [];
  let i = 0;
  const builder = (table: string, cols: string) => {
    const rec = { table, cols, filters: [] as string[][], limit: undefined as number | undefined };
    calls.push(rec);
    const b: Record<string, unknown> = {};
    b.filter = (c: string, op: string, v: string) => {
      rec.filters.push([c, op, v]);
      return b;
    };
    b.order = () => b;
    b.limit = (n: number) => {
      rec.limit = n;
      return b;
    };
    b.abortSignal = () => {
      const step = script[i++] ?? {};
      return Promise.resolve({ data: step.error ? null : (step.rows ?? []), error: step.error ?? null, count: null });
    };
    return b;
  };
  return {
    calls,
    client: {
      auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
      from: (table: string) => ({ select: (cols: string) => builder(table, cols) })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  };
}

const COL_MANCA = { code: '42703', message: 'column posts.content does not exist' };

describe('una colonna inventata non brucia il giro', () => {
  it('se il nome sbagliato stava solo in columns, va a leggere lo schema e rifà la lettura con *', async () => {
    const f = scriptedClient([
      { error: COL_MANCA }, // la lettura che il modello ha chiesto
      { rows: [{ id: 'p1', caption: 'ciao', status: 'published' }] }, // la sonda: una riga = lo schema
      { rows: [{ id: 'p1', caption: 'ciao', status: 'published' }] } // la rilettura con *
    ]);
    const out = await run(f.client, { table: 'posts', columns: ['id', 'content'] });
    expect(out.error, 'lo step deve consegnare dati, non una lezione').toBeUndefined();
    expect(out.rows).toHaveLength(1);
    // I nomi VERI arrivano al modello, ed è detto che le righe sono più larghe del richiesto.
    expect(out.limits).toContain('content');
    expect(out.limits).toContain('caption');
    expect(f.calls.map((c) => c.cols)).toEqual(['id,content', '*', '*']);
  });

  it('se il nome sbagliato stava in un filtro NON ritenta: togliere il filtro falsificherebbe la risposta', async () => {
    const f = scriptedClient([
      { error: COL_MANCA },
      { rows: [{ id: 'p1', caption: 'ciao' }] } // la sonda, e basta
    ]);
    const out = await run(f.client, { table: 'posts', where: [{ column: 'content', op: 'eq', value: 'x' }] });
    expect(out.error).toBe('42703');
    expect(out.columns_available).toEqual(['id', 'caption']);
    expect(out.fix).toContain('content');
    expect(f.calls).toHaveLength(2); // nessuna terza lettura senza il filtro
  });

  it('su una tabella vuota la sonda non insegna niente: resta il vecchio errore che spiega', async () => {
    const f = scriptedClient([{ error: COL_MANCA }, { rows: [] }]);
    const out = await run(f.client, { table: 'posts', columns: ['content'] });
    expect(out.error).toBe('42703');
    expect(out.fix).toContain('no columns');
  });

  it('il 42703 su brand_id resta quello di prima: si riprova senza il filtro imposto', async () => {
    const f = scriptedClient([
      { error: { code: '42703', message: 'column profiles.brand_id does not exist' } },
      { rows: [{ id: 'u1' }] }
    ]);
    const out = await run(f.client, { table: 'profiles' });
    expect(out.error).toBeUndefined();
    expect(out.rows).toHaveLength(1);
    expect(f.calls[1].filters.some((x) => x[0] === 'brand_id')).toBe(false);
  });
});
