import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  chatThreadId,
  chatThreads,
  clearUnread,
  markThreadRead,
  markThreadUnread,
  refreshThreads,
  unreadCount,
  unreadThreadIds
} from './chat';

describe('unread threads', () => {
  beforeEach(() => {
    unreadThreadIds.set(new Map());
    chatThreadId.set(null);
  });

  it('accende il pallino quando arriva un messaggio in un thread che non stai guardando', () => {
    markThreadUnread('t1');
    expect(get(unreadThreadIds).has('t1')).toBe(true);
  });

  it('lo spegne quando il thread viene aperto', () => {
    markThreadUnread('t1');
    markThreadRead('brand', 't1');
    expect(get(unreadThreadIds).has('t1')).toBe(false);
  });

  it('non ricrea la mappa se non cambia niente (niente re-render a vuoto)', () => {
    const before = get(unreadThreadIds);
    clearUnread('mai-stato-non-letto');
    expect(get(unreadThreadIds)).toBe(before);
  });

  it('al caricamento prende i non letti dal server, ma mai il thread aperto', async () => {
    chatThreadId.set('aperto');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [
            { id: 'aperto', unread: true, unread_count: 5 },
            { id: 'agente-notturno', unread: true, unread_count: 3 },
            { id: 'vecchio', unread: false }
          ]
        })
      })
    );
    await refreshThreads('brand');
    expect([...get(unreadThreadIds)]).toEqual([['agente-notturno', 3]]);
    vi.unstubAllGlobals();
  });

  it('porta il numero dal server, e senza numero mostra almeno 1', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [
            { id: 'contato', unread: true, unread_count: 4 },
            { id: 'senza-conto', unread: true },
            { id: 'letto', unread: false, unread_count: 0 }
          ]
        })
      })
    );
    await refreshThreads('brand');
    const map = get(unreadThreadIds);
    expect(unreadCount(map, 'contato')).toBe(4);
    expect(unreadCount(map, 'senza-conto')).toBe(1);
    expect(unreadCount(map, 'letto')).toBe(0);
    vi.unstubAllGlobals();
  });

  it('un altro messaggio mentre sei via fa +1 sul badge', () => {
    markThreadUnread('t1');
    markThreadUnread('t1');
    expect(unreadCount(get(unreadThreadIds), 't1')).toBe(2);
  });
});

/**
 * Misurato l'1/9: aprendo un thread la lista completa (`/chat/threads`, 94 thread, 63 KB e sei
 * query lato server) veniva chiesta TRE volte nello stesso secondo — sette chiamanti, nessuno
 * che sappia degli altri. Chi arriva mentre una richiesta è già in volo deve aspettare quella,
 * non aprirne un'altra.
 */
describe('refreshThreads non chiede la stessa lista più volte insieme', () => {
  beforeEach(() => {
    unreadThreadIds.set(new Map());
    chatThreadId.set(null);
  });

  it('tre chiamate concorrenti fanno una fetch sola', async () => {
    let resolve!: (v: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal('fetch', fetchMock);

    const all = Promise.all([refreshThreads('acme'), refreshThreads('acme'), refreshThreads('acme')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(new Response(JSON.stringify({ threads: [] }), { status: 200 }));
    await all;
  });

  it('finita la prima, una chiamata successiva riparte davvero', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ threads: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await refreshThreads('acme');
    await refreshThreads('acme');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * Riportato il 2/9: da un brand con delle chat se ne crea uno nuovo, e la sidebar del brand nuovo
 * mostra ancora le chat di quello di prima — spariscono «dopo un po'», cioè quando la lista nuova
 * arriva. La lista in memoria è di UN brand solo: appena se ne chiede un altro, quella di prima
 * non vale più. Il reset stava nella sidebar, che al passaggio per una rotta senza brand (la
 * creazione) si rimonta e non ha un brand precedente da confrontare.
 */
describe('la lista dei thread appartiene a un brand solo', () => {
  beforeEach(() => {
    chatThreads.set([]);
    unreadThreadIds.set(new Map());
    chatThreadId.set(null);
  });

  it('cambiando brand la lista di prima sparisce subito, non quando arriva la nuova', async () => {
    let resolve!: (v: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (resolve = r)))
    );

    const first = refreshThreads('acme');
    resolve(
      new Response(JSON.stringify({ threads: [{ id: 't1', unread: true, unread_count: 2 }] }), {
        status: 200
      })
    );
    await first;
    expect(get(chatThreads)).toHaveLength(1);
    expect(get(unreadThreadIds).size).toBe(1);

    const second = refreshThreads('brand-nuovo');
    expect(get(chatThreads)).toEqual([]);
    expect(get(unreadThreadIds).size).toBe(0);

    resolve(new Response(JSON.stringify({ threads: [] }), { status: 200 }));
    await second;
    vi.unstubAllGlobals();
  });
});
