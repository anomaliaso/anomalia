import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';

// Shared handle to the chat panel of the brand shell. Other surfaces — like
// the Panoramica home composer — drive the SAME chat through these stores instead of duplicating it.
export const chatOpen = writable(false);

// A message to send the moment the chat opens (consumed once by the panel, then reset to null).
export const chatPrefill = writable<string | null>(null);

// The currently active thread id.
export const chatThreadId = writable<string | null>(null);

/** Optional agent to apply when opening the empty composer (consumed once by ChatColumn). */
export const chatAgentPrefill = writable<string | null>(null);

/** Clear the active thread and open the Overview composer (no DB row until first send). */
export function openChatComposer(opts?: { prefill?: string; agent?: string; brandSlug?: string }) {
  chatThreadId.set(null);
  chatAgentPrefill.set(opts?.agent ?? null);
  if (opts?.prefill) chatPrefill.set(opts.prefill);
  else chatPrefill.set(null);
  const slug = opts?.brandSlug;
  if (browser && slug) {
    const target = `/app/${slug}`;
    const path = window.location.pathname;
    if (path !== target && path !== `${target}/`) {
      void goto(target, { noScroll: true, keepFocus: true });
    }
  }
}

/** One custom agent that has run in a thread — enough to draw its avatar. */
export type ThreadAgentAvatar = { id: string; name: string; face: string; color: string };

// All threads for the current brand+user, newest first.
export type ChatThread = {
  id: string;
  brand_id: string;
  user_id: string;
  title: string;
  /** Specialized agent for this thread (multi-agent chat). null = full/legacy. */
  agent?: string | null;
  /** Custom agents that have run in this thread, newest run first. */
  agents?: ThreadAgentAvatar[];
  /** Custom agent driving this thread, picked from the composer. */
  custom_agent_id?: string | null;
  /** Model preference saved on the thread (AgentModelPolicy | null): survives a reload anywhere. */
  model?: unknown;
  /**
   * Chat di gruppo (0209): le chiavi dei membri della stanza. Arriva già dalla lista (`select('*')`)
   * ed era l'unico pezzo del tipo che mancava — `threadIdentity` lo legge da sempre per il nome
   * della stanza, e il topbar per la fila di avatar. Un DM fra agenti mette qui un OGGETTO, non
   * un array: vedi `$lib/chat-dm`.
   */
  room_agents?: unknown;
  created_at: string;
  updated_at: string;
  /** Qualcosa è stato scritto qui dopo l'ultima volta che l'utente ha aperto il thread (0207). */
  unread?: boolean;
  /** Quanti messaggi dell'agente sono arrivati da allora — il numero sul badge in sidebar. */
  unread_count?: number;
  /** Anteprima già ridotta a una riga dell'ultimo messaggio (server, listThreadSnippets). */
  preview?: string | null;
};
export const chatThreads = writable<ChatThread[]>([]);

/**
 * I thread con qualcosa di non letto, e QUANTO: `threadId → numero di messaggi`. Una Map e non un
 * insieme perché il badge mostra il numero — `.has()` risponde come prima, il conto si legge con
 * `.get()`. Nessun contatore da riallineare: il numero vero lo ricalcola il server a ogni
 * caricamento (i messaggi dopo `last_read_at`), qui si tiene solo aggiornato dal vivo.
 * È l'UNICA fonte del non letto lato client: chiunque voglia un totale lo somma da qui.
 */
export const unreadThreadIds = writable<Map<string, number>>(new Map());

/** Quanti non letti mostrare per un thread: almeno 1, o il badge sarebbe una pillola vuota. */
export function unreadCount(map: Map<string, number>, threadId: string): number {
  return map.has(threadId) ? Math.max(1, map.get(threadId) ?? 0) : 0;
}

/**
 * Un messaggio è arrivato in un thread che l'utente non sta guardando. +1 e non il numero esatto:
 * il canale manda un evento per ogni salvataggio, il conto preciso torna al prossimo caricamento.
 */
export function markThreadUnread(threadId: string): void {
  unreadThreadIds.update((s) => new Map(s).set(threadId, (s.get(threadId) ?? 0) + 1));
}

/** Spegne il badge in locale (thread letto, o cancellato). */
export function clearUnread(threadId: string): void {
  unreadThreadIds.update((s) => {
    if (!s.has(threadId)) return s;
    const next = new Map(s);
    next.delete(threadId);
    return next;
  });
}

/**
 * L'utente sta guardando questo thread. Spegne il pallino subito e sposta il segnalibro sul
 * server, così anche il prossimo caricamento lo sa.
 */
export function markThreadRead(brandSlug: string, threadId: string): void {
  clearUnread(threadId);
  if (!browser) return;
  void fetch(`/app/${brandSlug}/chat/threads`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread_id: threadId, read: true })
  }).catch(() => {
    /* best-effort: al massimo il pallino torna al prossimo caricamento */
  });
}

/**
 * La lista dei thread, chiesta UNA volta anche quando la chiedono in sette.
 *
 * `/chat/threads` non è una lettura leggera: elenca tutti i thread del brand e ci monta sopra
 * avatar, anteprime, soglie di lettura e conteggi — sei query. Sette chiamanti indipendenti la
 * facevano partire tre volte nello stesso secondo all'apertura di un thread. Chi arriva mentre
 * una è in volo aspetta quella; la prossima, dopo, riparte davvero.
 */
const threadsInFlight = new Map<string, Promise<void>>();

export function refreshThreads(brandSlug: string): Promise<void> {
  const running = threadsInFlight.get(brandSlug);
  if (running) return running;

  const call = fetchThreads(brandSlug).finally(() => threadsInFlight.delete(brandSlug));
  threadsInFlight.set(brandSlug, call);
  return call;
}

async function fetchThreads(brandSlug: string): Promise<void> {
  try {
    const res = await fetch(`/app/${brandSlug}/chat/threads`);
    if (res.ok) {
      const data = await res.json();
      const threads: ChatThread[] = data.threads ?? [];
      chatThreads.set(threads);
      // Il thread aperto non è mai non letto: il server può averlo marcato tale per il messaggio
      // appena inviato, ma l'utente ce l'ha davanti — ChatColumn sposta il segnalibro subito dopo.
      const active = get(chatThreadId);
      unreadThreadIds.set(
        new Map(
          threads
            .filter((t) => t.unread && t.id !== active)
            .map((t) => [t.id, Math.max(1, t.unread_count ?? 0)] as const)
        )
      );
    }
  } catch (e) {
    console.error('[refreshThreads] Error:', e);
  }
}

/**
 * Create a new thread, add it to the store, and return its id.
 * Optional `agent` binds a specialized agent at creation (multi-agent chat).
 */
/** `agents` = chat di gruppo: 2-4 chiavi membro. Il server ignora tutto il resto (feature spenta,
 * meno di due membri validi) e il thread nasce normale. */
export async function createThread(
  brandSlug: string,
  title?: string,
  agent?: string,
  agents?: string[],
  customAgentId?: string | null
): Promise<string | null> {
  try {
    console.log('[createThread] Creating thread for:', brandSlug);
    const res = await fetch(`/app/${brandSlug}/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title ?? undefined,
        agent: agent ?? undefined,
        custom_agent_id: customAgentId ?? undefined,
        ...(agents && agents.length >= 2 ? { agents } : {})
      })
    });
    console.log('[createThread] Response status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('[createThread] Response data:', data);
      const thread = data.thread;
      if (thread) {
        chatThreads.update((threads) => [thread, ...threads]);
        chatThreadId.set(thread.id);
        console.log('[createThread] Thread created:', thread.id);
        return thread.id;
      }
    } else {
      const errorText = await res.text();
      console.error('[createThread] Error:', errorText);
    }
  } catch (e) {
    console.error('[createThread] Exception:', e);
  }
  return null;
}

/**
 * Bind the specialized agent to a thread (multi-agent chat) and update the store.
 */
export async function setThreadAgent(brandSlug: string, threadId: string, agent: string): Promise<boolean> {
  try {
    const res = await fetch(`/app/${brandSlug}/chat/threads`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, agent })
    });
    if (!res.ok) return false;
    chatThreads.update((threads) =>
      threads.map((t) => (t.id === threadId ? { ...t, agent } : t))
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Bind (or clear) the custom agent driving a thread. Its brief becomes the thread's persona.
 */
export async function setThreadCustomAgent(
  brandSlug: string,
  threadId: string,
  customAgentId: string | null
): Promise<boolean> {
  try {
    const res = await fetch(`/app/${brandSlug}/chat/threads`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, custom_agent_id: customAgentId })
    });
    if (!res.ok) return false;
    chatThreads.update((threads) =>
      threads.map((t) => (t.id === threadId ? { ...t, custom_agent_id: customAgentId } : t))
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Save (or clear, with null) the thread's model preference — the picker choice that has to
 * survive a reload on another device.
 */
export async function setThreadModel(
  brandSlug: string,
  threadId: string,
  model: unknown
): Promise<boolean> {
  try {
    const res = await fetch(`/app/${brandSlug}/chat/threads`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, model })
    });
    if (!res.ok) return false;
    chatThreads.update((threads) =>
      threads.map((t) => (t.id === threadId ? { ...t, model } : t))
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Rename a thread on the server and update the store.
 */
export async function renameThread(brandSlug: string, threadId: string, title: string): Promise<void> {
  try {
    await fetch(`/app/${brandSlug}/chat/threads`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, title })
    });
    chatThreads.update((threads) =>
      threads.map((t) => (t.id === threadId ? { ...t, title } : t))
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Delete a thread on the server and update the store.
 * If the deleted thread was active, switch to the first remaining thread.
 */
export async function deleteThread(brandSlug: string, threadId: string): Promise<void> {
  try {
    await fetch(`/app/${brandSlug}/chat/threads`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId })
    });
    chatThreads.update((threads) => threads.filter((t) => t.id !== threadId));
    clearUnread(threadId);
    // If we deleted the active thread, switch to the first remaining one
    if (get(chatThreadId) === threadId) {
      const remaining = get(chatThreads);
      chatThreadId.set(remaining.length > 0 ? remaining[0].id : null);
    }
  } catch {
    /* best-effort */
  }
}

// Open the global chat and send `text` as the first message.
export function openChatWith(text: string) {
  const t = text.trim();
  if (!t) return;
  chatPrefill.set(t);
  chatOpen.set(true);
}
