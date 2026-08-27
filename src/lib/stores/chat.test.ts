import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  chatThreadId,
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
