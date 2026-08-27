import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clearThreadContext, loadHistory } from './persistence';
import { isClearCommand } from '$lib/chat-commands';

/**
 * `/clear` deve fare DUE cose insieme, e sono l'una il contrario dell'altra: togliere i messaggi
 * dalla finestra del modello e lasciarli tutti in `chat_messages`. Un test che ne controlla una
 * sola non distingue `/clear` dal cestino — che è esattamente lo scambio da cui questo comando
 * deve stare lontano.
 *
 * Il finto client copre solo le catene che servono a queste due funzioni: non è un doppio di
 * Supabase, è il minimo per far girare la vera `clearThreadContext` contro la vera `loadHistory`.
 */
type Row = Record<string, unknown>;

function fakeSupabase(db: { chat_messages: Row[]; chat_threads: Row[] }) {
  function query(table: 'chat_messages' | 'chat_threads', patch?: Row) {
    const filters: Array<(r: Row) => boolean> = [];
    let orderKey = '';
    let descending = false;
    let lim = Infinity;

    const rows = () => {
      let out = db[table].filter((r) => filters.every((f) => f(r)));
      if (orderKey) {
        out = [...out].sort((a, b) => String(a[orderKey]).localeCompare(String(b[orderKey])));
        if (descending) out.reverse();
      }
      return out.slice(0, lim);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select: () => q,
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return q;
      },
      gt(col: string, val: unknown) {
        filters.push((r) => String(r[col]) > String(val));
        return q;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderKey = col;
        descending = opts?.ascending === false;
        return q;
      },
      limit(n: number) {
        lim = n;
        return q;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
        try {
          if (patch) for (const r of rows()) Object.assign(r, patch);
          return Promise.resolve({ data: patch ? null : rows(), error: null }).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      }
    };
    return q;
  }

  return {
    from(table: 'chat_messages' | 'chat_threads') {
      return {
        select: () => query(table),
        update: (patch: Row) => query(table, patch),
        insert(rows: Row[]) {
          const stamped = rows.map((r, i) => ({
            id: `new-${db.chat_messages.length + i}`,
            superseded: false,
            // Dopo l'ultimo messaggio esistente, come farebbe `now()` su Postgres.
            created_at: `2026-08-22T10:0${db.chat_messages.length + i}:00Z`,
            ...r
          }));
          db[table].push(...stamped);
          return { select: async () => ({ data: stamped.map((r) => ({ id: r.id })), error: null }) };
        }
      };
    }
  } as unknown as SupabaseClient;
}

const BRAND = 'b1';
const USER = 'u1';
const THREAD = 't1';

function seed() {
  return {
    chat_threads: [
      { id: THREAD, brand_id: BRAND, user_id: USER, summary: null, summary_upto: null, summary_message_count: 0 }
    ] as Row[],
    chat_messages: [
      { id: 'm1', brand_id: BRAND, user_id: USER, thread_id: THREAD, superseded: false, role: 'user', content: 'il segreto è la ricetta della nonna', created_at: '2026-08-22T09:00:00Z' },
      { id: 'm2', brand_id: BRAND, user_id: USER, thread_id: THREAD, superseded: false, role: 'assistant', content: 'annotato', created_at: '2026-08-22T09:01:00Z' },
      { id: 'm3', brand_id: BRAND, user_id: USER, thread_id: THREAD, superseded: false, role: 'user', content: 'e poi?', created_at: '2026-08-22T09:02:00Z' }
    ] as Row[]
  };
}

describe('/clear', () => {
  it('toglie i messaggi di prima dal contesto del modello, senza toglierli dalla conversazione', async () => {
    const db = seed();
    const supabase = fakeSupabase(db);

    const before = await loadHistory(supabase, BRAND, USER, THREAD);
    expect(before.map((m) => m.content)).toContain('il segreto è la ricetta della nonna');

    expect(await clearThreadContext(supabase, BRAND, USER, THREAD, 'contesto azzerato')).toBe(true);

    // 1. Il modello non vede più niente di quello che c'era prima.
    const after = await loadHistory(supabase, BRAND, USER, THREAD);
    expect(JSON.stringify(after)).not.toContain('ricetta della nonna');
    expect(JSON.stringify(after)).not.toContain('e poi?');

    // 2. La conversazione invece è tutta lì — più la riga che dice cos'è successo.
    expect(db.chat_messages.map((m) => m.id)).toEqual(expect.arrayContaining(['m1', 'm2', 'm3']));
    expect(db.chat_messages.some((m) => m.content === 'contesto azzerato')).toBe(true);
  });

  it('riconosce il comando solo quando è tutto il messaggio', () => {
    expect(isClearCommand('/clear')).toBe(true);
    expect(isClearCommand('  /PULISCI ')).toBe(true);
    expect(isClearCommand('/clear i post di ieri')).toBe(false);
    expect(isClearCommand('bisogna fare clear del piano')).toBe(false);
  });
});
