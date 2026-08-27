import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * UN solo mock supabase in-memory per i test, al posto dei cinque-e-più costruiti a
 * mano nei singoli file (`adminClient` in publish-digest, `mockClient` in cli-auth e
 * web-activation, `fakeSupabase` in disruptive-ideas…). Tabelle come array in memoria,
 * filtri VERI (eq/neq/in/gte/lt/ilike…), ordinamento, limit, count, scritture che
 * mutano le tabelle, iniezione di errori e log delle chiamate per le asserzioni.
 *
 * Perché filtri veri e non catene che ignorano gli argomenti: un mock che restituisce
 * le stesse righe qualunque sia il filtro non può accorgersi di un `.eq('brand_id')`
 * dimenticato — qui invece la riga sbagliata semplicemente non torna.
 *
 * Uso:
 *   const kit = createTestSupabase({ posts: [{ id: 'p1', brand_id: 'b1', status: 'published' }] });
 *   await buildDailyDigest(kit.client, 'b1');
 *   kit.calls              // → [{ table: 'posts', op: 'select', filters: [...] }]
 *   kit.tables.get('posts') // stato attuale dopo le scritture
 *   kit.failNext('posts', 'boom')  // la prossima query su posts risolve { data: null, error }
 *
 * Come PostgREST vero: le query NON rifiutano mai la promise — risolvono { data, error }.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
type Filter = { method: string; col: string; val: unknown };

export type RecordedCall = {
  table: string;
  op: Op;
  payload?: unknown;
  filters: Filter[];
  /**
   * Le colonne chieste a `.select()`. Non vengono PROIETTATE — il finto client torna la riga
   * intera, e cambiarlo romperebbe mezzo repo — ma vengono registrate, perche` una select che
   * dimentica una colonna e` un difetto che nessun test poteva vedere: qui il dato arriva
   * comunque, in produzione no.
   */
  columns?: string;
};

export type TestSupabase = {
  client: SupabaseClient;
  /** Stato vivo delle tabelle — le scritture dei test lo mutano davvero. */
  tables: Map<string, Row[]>;
  /** Ogni query eseguita (all'await), in ordine, per le asserzioni. */
  calls: RecordedCall[];
  rpcCalls: Array<{ fn: string; args: unknown }>;
  /** La prossima query su `table` (opzionalmente solo per `op`) risolve con questo errore. */
  failNext: (table: string, message: string, op?: Op) => void;
};

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col];
  switch (f.method) {
    case 'eq':
      return v === f.val;
    case 'neq':
      return v !== f.val;
    case 'in':
      return Array.isArray(f.val) && (f.val as unknown[]).includes(v);
    case 'is':
      return v === f.val || (f.val === null && v === undefined);
    // Confronti su stringhe ISO e numeri: l'ordinamento naturale JS basta per entrambi.
    case 'gte':
      return v != null && v >= (f.val as never);
    case 'gt':
      return v != null && v > (f.val as never);
    case 'lte':
      return v != null && v <= (f.val as never);
    case 'lt':
      return v != null && v < (f.val as never);
    case 'ilike': {
      const rx = new RegExp(
        '^' + String(f.val).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$',
        'i'
      );
      return rx.test(String(v ?? ''));
    }
    default:
      // ponytail: filtri esotici (or, contains, textSearch) non ancora serviti da nessun
      // test migrato — aggiungerli qui quando il primo test ne ha bisogno.
      return true;
  }
}

export function createTestSupabase(seed: Record<string, Row[]> = {}): TestSupabase {
  const tables = new Map<string, Row[]>(
    Object.entries(seed).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))])
  );
  const calls: RecordedCall[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const pendingErrors: Array<{ table: string; op?: Op; message: string }> = [];

  const failNext = (table: string, message: string, op?: Op) => {
    pendingErrors.push({ table, op, message });
  };

  function from(table: string) {
    if (!tables.has(table)) tables.set(table, []);
    const state = {
      op: 'select' as Op,
      payload: undefined as unknown,
      filters: [] as Filter[],
      columns: undefined as string | undefined,
      order: null as { col: string; ascending: boolean } | null,
      limit: null as number | null,
      head: false,
      counting: false
    };

    // Eseguita all'await (o su maybeSingle/single): filtra, scrive, registra.
    const run = (): { data: Row[] | null; error: { message: string } | null; count: number | null } => {
      calls.push({ table, op: state.op, payload: state.payload, filters: state.filters, columns: state.columns });

      const errIdx = pendingErrors.findIndex(
        (e) => e.table === table && (e.op === undefined || e.op === state.op)
      );
      if (errIdx >= 0) {
        const [e] = pendingErrors.splice(errIdx, 1);
        return { data: null, error: { message: e.message }, count: null };
      }

      const all = tables.get(table)!;
      const hit = (r: Row) => state.filters.every((f) => matches(r, f));
      let result: Row[];

      if (state.op === 'insert') {
        const rows = (Array.isArray(state.payload) ? state.payload : [state.payload]) as Row[];
        // L'id lo mette il DATABASE (default gen_random_uuid), non il chiamante: senza, ogni
        // `insert().select('id')` tornava nulla e il codice leggeva un fallimento dove la riga
        // era stata scritta benissimo.
        result = rows.map((r) => ({ ...r, ...(r.id === undefined ? { id: randomUUID() } : {}) }));
        all.push(...result);
      } else if (state.op === 'update') {
        result = all.filter(hit);
        for (const r of result) Object.assign(r, state.payload as Row);
      } else if (state.op === 'upsert') {
        const rows = (Array.isArray(state.payload) ? state.payload : [state.payload]) as Row[];
        result = [];
        for (const r of rows) {
          // ponytail: match di conflitto solo su `id` — passare/parsare onConflict quando
          // un test migrato userà una chiave diversa.
          const existing = all.find((x) => x.id !== undefined && x.id === r.id);
          if (existing) {
            Object.assign(existing, r);
            result.push(existing);
          } else {
            const copy = { ...r };
            all.push(copy);
            result.push(copy);
          }
        }
      } else if (state.op === 'delete') {
        result = all.filter(hit);
        tables.set(table, all.filter((r) => !hit(r)));
      } else {
        result = all.filter(hit);
        if (state.order) {
          const { col, ascending } = state.order;
          result = [...result].sort((a, b) =>
            a[col] < b[col] ? (ascending ? -1 : 1) : a[col] > b[col] ? (ascending ? 1 : -1) : 0
          );
        }
      }

      // Come PostgREST: count = righe che matchano PRIMA del limit.
      const count = state.counting ? result.length : null;
      if (state.limit != null) result = result.slice(0, state.limit);
      return { data: state.head ? null : result, error: null, count };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: (cols?: string, opts?: { count?: string; head?: boolean }) => {
        // `.insert(x).select()` non deve sovrascrivere l'op di scrittura.
        if (cols) state.columns = cols;
        if (opts?.count) state.counting = true;
        if (opts?.head) state.head = true;
        return builder;
      },
      insert: (payload: unknown) => ((state.op = 'insert'), (state.payload = payload), builder),
      update: (payload: unknown) => ((state.op = 'update'), (state.payload = payload), builder),
      upsert: (payload: unknown) => ((state.op = 'upsert'), (state.payload = payload), builder),
      delete: () => ((state.op = 'delete'), builder),
      order: (col: string, opts?: { ascending?: boolean }) => (
        (state.order = { col, ascending: opts?.ascending !== false }), builder
      ),
      limit: (n: number) => ((state.limit = n), builder),
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        return data?.length
          ? { data: data[0], error: null }
          : { data: null, error: { message: `single(): no rows in ${table}` } };
      },
      then: (
        onOk: (v: { data: Row[] | null; error: { message: string } | null; count: number | null }) => unknown,
        onErr?: (e: unknown) => unknown
      ) => Promise.resolve(run()).then(onOk, onErr)
    };
    for (const m of ['eq', 'neq', 'in', 'is', 'gte', 'gt', 'lte', 'lt', 'ilike']) {
      builder[m] = (col: string, val: unknown) => (state.filters.push({ method: m, col, val }), builder);
    }
    return builder;
  }

  const client = {
    from,
    rpc: async (fn: string, args?: unknown) => {
      rpcCalls.push({ fn, args });
      return { data: null, error: null };
    }
  } as unknown as SupabaseClient;

  return { client, tables, calls, rpcCalls, failNext };
}
