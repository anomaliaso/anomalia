import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createQueryTool,
  explainDbError,
  DB_STATEMENT_TIMEOUT_MS,
  NO_SESSION_ERROR,
  QUERY_MAX_CHARS,
  QUERY_MAX_VALUE_CHARS,
  QUERY_MAX_DOC_CHARS,
  QUERY_MAX_ROWS,
  QUERY_TABLE_LIST
} from './query-tool';
import { markRlsScoped } from '$lib/server/rls-client';

vi.mock('$lib/server/ai-log', () => ({ logAiCall: vi.fn() }));
import { logAiCall } from '$lib/server/ai-log';

/**
 * Un client finto che si comporta come PostgREST: registra COSA gli è stato chiesto (per poter
 * dimostrare che certe chiamate non partono mai) e restituisce quel che gli si dice.
 */
type Call = {
  table: string;
  cols: string;
  countMode?: string;
  filters: string[][];
  orders: Array<[string, { ascending?: boolean; nullsFirst?: boolean } | undefined]>;
  range?: [number, number];
  limit?: number;
};

const newCall = (table: string, cols: string, countMode?: string): Call => ({
  table,
  cols,
  countMode,
  filters: [],
  orders: []
});

/** Registra ogni pezzo della richiesta, così un test può dimostrare cosa è arrivato al filo. */
function recordingBuilder(rec: Call, answer: () => Promise<unknown>): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  b.filter = (c: string, op: string, v: string) => {
    rec.filters.push([c, op, v]);
    return b;
  };
  b.order = (c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => {
    rec.orders.push([c, o]);
    return b;
  };
  b.range = (from: number, to: number) => {
    rec.range = [from, to];
    return b;
  };
  b.limit = (n: number) => {
    rec.limit = n;
    return b;
  };
  b.abortSignal = answer;
  return b;
}

function fakeClient(opts: {
  authority?: 'user' | 'service';
  session?: { access_token: string } | null;
  rows?: Array<Record<string, unknown>>;
  count?: number;
  error?: { code: string; message: string; hint?: string | null; details?: string | null };
}) {
  const calls: Array<Call> = [];
  const builder = (table: string, cols: string, countMode?: string) => {
    const rec = newCall(table, cols, countMode);
    calls.push(rec);
    return recordingBuilder(rec, () =>
      Promise.resolve({ data: opts.error ? null : (opts.rows ?? []), error: opts.error ?? null, count: opts.count ?? null })
    );
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: opts.session === undefined ? { access_token: 'jwt' } : opts.session } }) },
    from: (table: string) => ({ select: (cols: string, o?: { count?: string }) => builder(table, cols, o?.count) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // Il default è il client dell'utente, che è il caso di ogni test tranne quelli sul cancello:
  // `authority: 'service'` lo lascia senza marchio, che è ciò che rende la service role respinta.
  return { calls, client: opts.authority === 'service' ? client : markRlsScoped(client) };
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
    expect(calls[0]).toMatchObject({ table: 'posts', cols: 'id', range: [0, 4] });
    expect(calls[0].filters).toEqual([['brand_id', 'eq', 'b1']]);
  });
});

describe('il cancello: senza sessione utente non si legge', () => {
  it('un client service-role viene respinto, e non tocca il database', async () => {
    const { client, calls } = fakeClient({ authority: 'service', rows: [{ id: 'segreto-di-un-altro-brand' }] });
    const out = await run(client, { table: 'posts' });
    expect(out.error).toBe('no_user_session');
    expect(out).not.toHaveProperty('rows');
    expect(calls).toHaveLength(0);
  });

  it('il rifiuto spiega che la service role scavalcherebbe la RLS', () => {
    expect(NO_SESSION_ERROR.message).toMatch(/RLS/);
    expect(NO_SESSION_ERROR.message).toMatch(/service-role/);
  });

  it('il rifiuto nomina anche la chiave API, che è più stretta dei brand dell utente', () => {
    expect(NO_SESSION_ERROR.message).toMatch(/brand_ids/);
  });

  /**
   * Chi legge questo rifiuto NON è nella chat: `query` si nega solo alla service role, cioè al
   * percorso a chiave API e alla coda. `read_posts`, `read_brand_kit` e `read_plan` esistono
   * davvero — sono tool della chat — ma su quella superficie non ci sono, quindi il consiglio
   * mandava a cercare tre nomi che il chiamante non può vedere.
   *
   * E una lista di nomi in un messaggio d'errore invecchia da sola: i tool di lettura si stanno
   * unificando dentro `query`. Il rimedio nomina la SUPERFICIE, che non cambia.
   */
  it('il rimedio non manda a cercare tool che il chiamante non ha', () => {
    for (const chatOnly of ['read_posts', 'read_brand_kit', 'read_plan']) {
      expect(NO_SESSION_ERROR.fix).not.toContain(chatOnly);
    }
  });

  it('il rimedio dice come si torna dentro, non solo che si è fuori', () => {
    expect(NO_SESSION_ERROR.fix).toMatch(/anomalia login/);
  });
});

/**
 * IL PERCORSO API (CLI e MCP) PORTA IL CLIENT GIUSTO E VENIVA RIFIUTATO LO STESSO.
 *
 * `cli-auth.ts` costruisce il client del percorso JWT con la chiave anon e l'header dell'utente,
 * ma con i cookie a vuoto: `auth.getSession()` risponde `null` — misurato — pur essendo un client
 * a cui Postgres applica le policy dell'utente. Il cancello guardava la sessione, e chiudeva la
 * porta proprio al client corretto mentre la service role restava fuori per la ragione giusta.
 */
describe('il cancello guarda i permessi, non la sessione', () => {
  it('un client RLS-scoped SENZA sessione legge: è il percorso JWT di CLI e MCP', async () => {
    const { client, calls } = fakeClient({ session: null, rows: [{ id: 'p1' }] });

    const out = await run(client, { table: 'posts' });

    expect(out.error).toBeUndefined();
    expect(out.rows).toEqual([{ id: 'p1' }]);
    expect(calls).toHaveLength(1);
  });

  /**
   * La seconda metà, che è quella che conta: dal percorso API non deve comparire NIENTE che dal
   * browser non si vedeva. Quali righe tornano lo decide Postgres, quindi qui si verifica l'unica
   * cosa che potrebbe farle divergere — che la richiesta parta identica: stessa tabella, stesse
   * colonne, stessi filtri, stesso tetto. Marchiare un client non allarga la lettura.
   */
  it('stessa domanda dai due percorsi, stessa richiesta al database — non una riga in più', async () => {
    const browser = fakeClient({ session: { access_token: 'jwt' }, rows: [{ id: 'p1' }] });
    const api = fakeClient({ session: null, rows: [{ id: 'p1' }] });

    const fromBrowser = await run(browser.client, { table: 'posts', columns: ['id'], limit: 5 });
    const fromApi = await run(api.client, { table: 'posts', columns: ['id'], limit: 5 });

    expect(fromApi.rows).toEqual(fromBrowser.rows);
    expect(api.calls).toEqual(browser.calls);
  });

  it('la service role resta respinta anche con una sessione: decide il marchio, non il token', async () => {
    const { client, calls } = fakeClient({ authority: 'service', session: { access_token: 'jwt' }, rows: [{ id: 'ogni-brand' }] });

    const out = await run(client, { table: 'posts' });

    expect(out.error).toBe('no_user_session');
    expect(calls).toHaveLength(0);
  });

  it('il marchio non si mette sul client service-role, in nessun punto del sorgente', () => {
    const admin = readFileSync(new URL('../supabase-admin.ts', import.meta.url), 'utf8');
    expect(admin).not.toContain('markRlsScoped');
  });
});

/**
 * IL GUARDIANO DELLA LISTA. Fallisce da solo il giorno in cui una migrazione aggiunge una tabella,
 * che è precisamente il giorno in cui serve: su MCP la lista è un `enum`, e un nome mancante non
 * confonde l'agente — gli impedisce di chiedere una tabella che esiste.
 */
describe('le tabelle si generano dalle migrazioni, non si battono a mano', () => {
  it('query-tables.ts è allineato alle migrazioni', async () => {
    const { tablesFromMigrations } = await import('../../../../scripts/query-tables-from-migrations.mjs');

    expect(QUERY_TABLE_LIST).toEqual(tablesFromMigrations());
  });

  it('niente backup e niente tabelle che nessuna migrazione crea', () => {
    // I primi tre esistono in produzione ma non da un'installazione da zero; il quarto è un backup
    // fatto a mano. Nessuno dei quattro va nominato all'agente, e la regola li esclude tutti senza
    // un elenco di eccezioni: una tabella esiste se una migrazione la crea.
    for (const ghost of ['asset_projects', 'asset_project_files', 'mcp_logs', 'thread_events_backup_20260901']) {
      expect(QUERY_TABLE_LIST).not.toContain(ghost);
    }
  });

  it('nessuna tabella fuori da public: uno schema diverso non entra', () => {
    expect(QUERY_TABLE_LIST).not.toContain('stripe');
    expect(QUERY_TABLE_LIST.every((t) => !t.includes('.'))).toBe(true);
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
    expect(calls[0].range).toEqual([0, QUERY_MAX_ROWS - 1]);
  });

  it('il taglio sui caratteri è per riga intera E viene dichiarato', async () => {
    // Ogni valore sta SOTTO il tetto per-valore (1.900 < 2.000): quello che morde qui è il tetto
    // per riga, e le due cose vanno viste separate o un test copre il buco dell'altro.
    const big = 'x'.repeat(1_900);
    // Quante bastino a sfondare il tetto qualunque esso sia: il numero si ricava, non si batte.
    const troppe = Math.ceil(QUERY_MAX_CHARS / 1_900) + 5;
    const { client } = fakeClient({ rows: Array.from({ length: troppe }, (_, i) => ({ id: i, body: big })), count: troppe });
    const out = await run(client, { table: 'brand_documents', limit: troppe });
    expect(out.returned).toBeLessThan(troppe);
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
    expect(out.limits).toContain(String(QUERY_MAX_DOC_CHARS));
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
    expect(explainDbError('PGRST200', 'no relationship')).toMatch(/foreign key/i);
  });
});

/**
 * 2.000 → 3.000. `query` è ora la lettura del prodotto e non un ripiego: paginazione, conteggio
 * esatto, negazione, embed e la regola sulle `columns` si spiegano QUI, dove il chiamante legge
 * nel momento in cui gli serve. Il budget si alza perché il conto complessivo scende — le
 * trentatré letture ritirate pesavano ~11.000 caratteri di descrizione, questa ne prende ~1.400.
 * Se un giorno cresce senza portare via niente, questo numero è il posto dove ci si ferma.
 */
const DESCRIPTION_MAX_CHARS = 3_000;

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
    expect(desc.length).toBeLessThan(DESCRIPTION_MAX_CHARS);
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
    for (const [input, authority] of [
      [{ table: 'posts' }, 'service'],
      [{ table: 'posts; insert into x' }, 'user']
    ] as const) {
      vi.mocked(logAiCall).mockClear();
      const { client } = fakeClient({ authority });
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
  const calls: Array<Call> = [];
  let i = 0;
  const builder = (table: string, cols: string, countMode?: string) => {
    const rec = newCall(table, cols, countMode);
    calls.push(rec);
    return recordingBuilder(rec, () => {
      const step = script[i++] ?? {};
      return Promise.resolve({ data: step.error ? null : (step.rows ?? []), error: step.error ?? null, count: null });
    });
  };
  return {
    calls,
    client: markRlsScoped({
      auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
      from: (table: string) => ({ select: (cols: string, o?: { count?: string }) => builder(table, cols, o?.count) })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
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

/**
 * Le capacità che rendono `query` la lettura del prodotto e non un ripiego. Ognuna esiste perché
 * una lettura ritirata la richiedeva: senza, togliere quel tool sarebbe stato perdere una risposta.
 */
describe('`query` legge tutto quello che leggevano i tool ritirati', () => {
  it('pagina: `offset` porta alla riga 51 di list_posts, che prima era irraggiungibile', async () => {
    const { client, calls } = fakeClient({ rows: [{ id: 'p51' }], count: 120 });
    const out = await run(client, { table: 'posts', columns: ['id'], limit: 50, offset: 50 });

    expect(calls[0].range).toEqual([50, 99]);
    expect(out.rows).toEqual([{ id: 'p51' }]);
  });

  it('conta esatto quando glielo chiedi: «quanti post in attesa» non è una stima', async () => {
    const { client, calls } = fakeClient({ rows: [], count: 37 });
    const out = await run(client, { table: 'posts', columns: ['id'], count: 'exact', limit: 1 });

    expect(calls[0].countMode).toBe('exact');
    expect(out.total).toBe(37);
    expect(out.limits).not.toMatch(/estimate/i);
  });

  it('la stima resta il default: un conteggio esatto su una tabella enorme scade a 8s', async () => {
    const { client, calls } = fakeClient({ rows: [{ id: 'p1' }], count: 9000 });
    await run(client, { table: 'posts', columns: ['id'] });

    expect(calls[0].countMode).toBe('estimated');
  });

  it('il troncamento NON è muto: dice quante righe ha tagliato e con che offset si prende il resto', async () => {
    const wide = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, caption: 'x'.repeat(3_000) }));
    const { client } = fakeClient({ rows: wide, count: 40 });
    const out = await run(client, { table: 'posts', columns: ['id', 'caption'], limit: 40 });

    expect(out.returned).toBeLessThan(40);
    expect(out.limits).toMatch(/offset/i);
    expect(out.limits).toContain(String(out.returned));
  });

  it('una riga sola torna INTERA: un articolo si legge per riscriverlo, non per assaggiarlo', async () => {
    const body = 'a'.repeat(QUERY_MAX_VALUE_CHARS * 3);
    const { client } = fakeClient({ rows: [{ id: 'a1', body_md: body }], count: 1 });
    const out = await run(client, { table: 'brand_articles', columns: ['id', 'body_md'], limit: 1 });

    expect(out.rows[0].body_md).toBe(body);
    expect(out.limits).not.toMatch(/Values cut/);
  });

  it('più righe: il tetto per valore torna a mordere, e dice in quale colonna', async () => {
    const body = 'a'.repeat(QUERY_MAX_VALUE_CHARS * 3);
    const { client } = fakeClient({ rows: [{ id: 'a1', body_md: body }, { id: 'a2', body_md: body }], count: 2 });
    const out = await run(client, { table: 'brand_articles', columns: ['id', 'body_md'], limit: 2 });

    expect(String(out.rows[0].body_md).length).toBeLessThan(body.length);
    expect(out.limits).toContain('body_md');
  });

  it('nega un filtro: «scheduled_for non è nullo» era il calendario, e non si sapeva scrivere', async () => {
    const { client, calls } = fakeClient({ rows: [{ id: 'p1' }], count: 1 });
    await run(client, {
      table: 'posts',
      columns: ['id'],
      where: [{ column: 'scheduled_for', op: 'is', value: null, negate: true }]
    });

    expect(calls[0].filters).toContainEqual(['scheduled_for', 'not.is', 'null']);
  });

  it('ordina su più colonne, e dice dove vanno i nulli', async () => {
    const { client, calls } = fakeClient({ rows: [], count: 0 });
    await run(client, {
      table: 'posts',
      columns: ['id'],
      order: [
        { column: 'slot', ascending: true, nullsFirst: false },
        { column: 'created_at', ascending: false }
      ]
    });

    expect(calls[0].orders).toEqual([
      ['slot', { ascending: true, nullsFirst: false }],
      ['created_at', { ascending: false, nullsFirst: undefined }]
    ]);
  });

  it('un ordinamento singolo continua a funzionare come prima', async () => {
    const { client, calls } = fakeClient({ rows: [], count: 0 });
    await run(client, { table: 'posts', columns: ['id'], order: { column: 'created_at' } });

    expect(calls[0].orders).toEqual([['created_at', { ascending: false, nullsFirst: undefined }]]);
  });

  it('incorpora una tabella collegata: l’articolo con la sua categoria, in una chiamata', async () => {
    const { client, calls } = fakeClient({ rows: [{ id: 'a1', blog_categories: { name: 'Guide' } }], count: 1 });
    const out = await run(client, {
      table: 'brand_articles',
      columns: ['id'],
      embed: [{ table: 'blog_categories', columns: ['name'] }]
    });

    expect(calls[0].cols).toBe('id,blog_categories(name)');
    expect(out.rows[0].blog_categories).toEqual({ name: 'Guide' });
  });

  it('l’embed passa dallo stesso setaccio: non è un buco per infilare SQL', async () => {
    const { client, calls } = fakeClient({ rows: [] });
    for (const embed of [
      [{ table: 'blog_categories)' }],
      [{ table: 'blog_categories', columns: ['name); drop table posts'] }]
    ]) {
      const out = await run(client, { table: 'brand_articles', columns: ['id'], embed });
      expect(out.error).toBe('not_an_identifier');
    }
    expect(calls).toHaveLength(0);
  });

  it('un embed senza `columns` prende tutta la riga collegata', async () => {
    const { client, calls } = fakeClient({ rows: [], count: 0 });
    await run(client, { table: 'brand_articles', columns: ['id'], embed: [{ table: 'blog_authors' }] });

    expect(calls[0].cols).toBe('id,blog_authors(*)');
  });

  it('il confine del brand resta imposto anche con offset, count ed embed', async () => {
    const { client, calls } = fakeClient({ rows: [], count: 0 });
    await run(client, {
      table: 'posts',
      columns: ['id'],
      offset: 20,
      count: 'exact',
      embed: [{ table: 'brands', columns: ['name'] }]
    });

    expect(calls[0].filters).toContainEqual(['brand_id', 'eq', 'b1']);
  });
});
