import { describe, it, expect, vi } from 'vitest';
import { isUnread, loadLastReads, loadUnreadCounts, markThreadRead } from './unread';
import { saveMessages } from './persistence';
import { broadcastToBrand } from '$lib/server/realtime';

vi.mock('$lib/server/realtime', () => ({ broadcastToBrand: vi.fn() }));

/** Client finto: `select(...).eq(...).in(...)` risolve con quello che gli si passa. */
function selectClient(result: { data?: unknown; error?: { message: string } } | Error) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))
  };
  return { from: () => chain } as never;
}

describe('isUnread', () => {
  it('flags a thread touched after the last look (the agent replied while nobody watched)', () => {
    expect(isUnread('2026-08-21T10:05:00+00:00', '2026-08-21T10:00:00.000Z')).toBe(true);
  });

  it('compares instants, not strings — postgrest writes +00:00 where toISOString writes Z', () => {
    // Come testo '2026-08-21T10:00:00+00:00' > '2026-08-21T10:00:00.000Z' sarebbe falso: stesso
    // istante, formati diversi. Deve restare "letto".
    expect(isUnread('2026-08-21T10:00:00+00:00', '2026-08-21T10:00:00.000Z')).toBe(false);
  });

  it('treats a thread with no read row as read — no badge storm on old history', () => {
    expect(isUnread('2026-08-21T10:05:00Z', undefined)).toBe(false);
    expect(isUnread('2026-08-21T10:05:00Z', null)).toBe(false);
  });
});

describe('loadLastReads', () => {
  it('maps thread_id → last_read_at', async () => {
    const supabase = selectClient({
      data: [
        { thread_id: 't1', last_read_at: '2026-08-21T10:00:00+00:00' },
        { thread_id: 't2', last_read_at: '2026-08-20T09:00:00+00:00' }
      ]
    });
    expect(await loadLastReads(supabase, 'u1', ['t1', 't2'])).toEqual({
      t1: '2026-08-21T10:00:00+00:00',
      t2: '2026-08-20T09:00:00+00:00'
    });
  });

  it('degrades to "everything read" when the table is not there yet (migrations run by hand)', async () => {
    const missing = selectClient({
      error: { message: 'relation "public.chat_thread_reads" does not exist' }
    });
    expect(await loadLastReads(missing, 'u1', ['t1'])).toEqual({});
    // E anche se il client alza invece di tornare `{ error }`.
    expect(await loadLastReads(selectClient(new Error('boom')), 'u1', ['t1'])).toEqual({});
  });

  it('does not query at all with no threads', async () => {
    const from = vi.fn();
    expect(await loadLastReads({ from } as never, 'u1', [])).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });
});

describe('loadUnreadCounts', () => {
  /**
   * Client finto sulla catena vera di postgrest, che registra QUANTE query partono e con quali
   * filtri: il punto è che sia una sola per tutta la pagina, mai una per thread.
   */
  function messagesClient(result: { data?: unknown; error?: { message: string } } | Error) {
    const calls: { from: number; filters: Record<string, unknown> } = { from: 0, filters: {} };
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'gt', 'eq', 'neq', 'order']) {
      chain[m] = (a: unknown, b: unknown) => {
        calls.filters[m] = b === undefined ? a : [a, b];
        return chain;
      };
    }
    chain.limit = () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result));
    const supabase = {
      from: () => {
        calls.from += 1;
        return chain;
      }
    } as never;
    return { supabase, calls };
  }

  const rows = [
    { thread_id: 't1', created_at: '2026-08-21T10:30:00+00:00' },
    { thread_id: 't1', created_at: '2026-08-21T10:20:00+00:00' },
    // Più vecchio della soglia di t2: è arrivato con la stessa query, ma per t2 non conta.
    { thread_id: 't2', created_at: '2026-08-21T09:00:00+00:00' },
    { thread_id: 't2', created_at: '2026-08-21T11:00:00+00:00' }
  ];

  it('conta per thread con la soglia sua, in UNA query per tutta la pagina', async () => {
    const { supabase, calls } = messagesClient({ data: rows });
    const counts = await loadUnreadCounts(supabase, {
      t1: '2026-08-21T10:00:00+00:00',
      t2: '2026-08-21T10:00:00+00:00'
    });
    expect(counts).toEqual({ t1: 2, t2: 1 });
    expect(calls.from).toBe(1);
  });

  it('parte dalla soglia più vecchia, e non conta i messaggi scritti dall\'utente', async () => {
    const { supabase, calls } = messagesClient({ data: [] });
    await loadUnreadCounts(supabase, {
      t1: '2026-08-21T10:00:00+00:00',
      t2: '2026-08-20T08:00:00+00:00'
    });
    expect(calls.filters.in).toEqual(['thread_id', ['t1', 't2']]);
    expect(calls.filters.gt).toEqual(['created_at', '2026-08-20T08:00:00.000Z']);
    // Solo le risposte dell'agente, e solo quelle con del testo dentro.
    expect(calls.filters.eq).toEqual(['role', 'assistant']);
    expect(calls.filters.neq).toEqual(['content', '']);
  });

  it('non interroga niente se non c\'è nessun thread non letto', async () => {
    const from = vi.fn();
    expect(await loadUnreadCounts({ from } as never, {})).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('senza la tabella 0207 non si conta niente: nessuna soglia, nessuna query', async () => {
    // loadLastReads degrada a {} → il server non mette niente in `since` → zero query, zero badge.
    const reads = await loadLastReads(
      selectClient({ error: { message: 'relation "public.chat_thread_reads" does not exist' } }),
      'u1',
      ['t1']
    );
    const from = vi.fn();
    expect(await loadUnreadCounts({ from } as never, reads)).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('degrada a nessun conto se la query fallisce o alza', async () => {
    expect(
      await loadUnreadCounts(messagesClient({ error: { message: 'boom' } }).supabase, {
        t1: '2026-08-21T10:00:00+00:00'
      })
    ).toEqual({});
    expect(
      await loadUnreadCounts(messagesClient(new Error('boom')).supabase, {
        t1: '2026-08-21T10:00:00+00:00'
      })
    ).toEqual({});
  });
});

describe('markThreadRead', () => {
  it('upserts on the (thread, user) pair so a second look just moves the bookmark', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ upsert }) } as never;
    await markThreadRead(supabase, 't1', 'u1', '2026-08-21T10:00:00.000Z');
    expect(upsert).toHaveBeenCalledWith(
      { thread_id: 't1', user_id: 'u1', last_read_at: '2026-08-21T10:00:00.000Z' },
      { onConflict: 'thread_id,user_id' }
    );
  });

  it('never throws when the table is missing', async () => {
    const supabase = {
      from: () => ({
        upsert: () => Promise.reject(new Error('relation does not exist'))
      })
    } as never;
    await expect(markThreadRead(supabase, 't1', 'u1')).resolves.toBeUndefined();
  });
});

describe('saveMessages ↔ read state', () => {
  /** Client finto che registra solo gli upsert sui segnalibri. */
  function client(reads: Record<string, unknown>[]) {
    return {
      from: (table: string) => {
        if (table === 'chat_thread_reads') {
          return {
            upsert: (row: Record<string, unknown>) => {
              reads.push(row);
              return Promise.resolve({ error: null });
            }
          };
        }
        if (table === 'chat_threads') return { update: () => ({ eq: async () => ({}) }) };
        return {
          insert: (rows: unknown[]) => ({
            select: async () => ({ data: (rows as unknown[]).map((_, i) => ({ id: `r${i}` })), error: null })
          })
        };
      }
    } as never;
  }

  it('un messaggio scritto dall\'utente non accende il badge sul suo stesso thread', async () => {
    const reads: Record<string, unknown>[] = [];
    await saveMessages(client(reads), 'b1', 'u1', [{ role: 'user', content: 'ciao' }], 't1');
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ thread_id: 't1', user_id: 'u1' });
  });

  it('la risposta dell\'agente NON si segna letta da sola', async () => {
    const reads: Record<string, unknown>[] = [];
    await saveMessages(client(reads), 'b1', 'u1', [{ role: 'assistant', content: 'fatto' }], 't1');
    expect(reads).toHaveLength(0);
  });

  it('un turno salvato tutto insieme lascia non letta la risposta che nessuno ha visto', async () => {
    const reads: Record<string, unknown>[] = [];
    await saveMessages(
      client(reads),
      'b1',
      'u1',
      [
        { role: 'user', content: 'ciao' },
        { role: 'assistant', content: 'fatto' }
      ],
      't1'
    );
    expect(reads).toHaveLength(0);
  });

  it('announces whether the saved batch contains an agent reply', async () => {
    const announced = vi.mocked(broadcastToBrand);
    announced.mockClear();

    await saveMessages(client([]), 'b1', 'u1', [{ role: 'user', content: 'ciao' }], 't1');
    await saveMessages(client([]), 'b1', 'u1', [{ role: 'assistant', content: 'fatto' }], 't1');

    expect(announced).toHaveBeenNthCalledWith(1, 'b1', {
      event: 'thread-changed',
      payload: { threadId: 't1', hasAssistantReply: false }
    });
    expect(announced).toHaveBeenNthCalledWith(2, 'b1', {
      event: 'thread-changed',
      payload: { threadId: 't1', hasAssistantReply: true }
    });
  });
});
