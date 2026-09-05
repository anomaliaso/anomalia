import { writable } from 'svelte/store';
import type { Snippet } from 'svelte';

export type PageMeta = {
  title: string | null;
  subtitle?: string | null;
  section?: string | null;
  /** Volto accanto al titolo — l'identità dell'agente quando la pagina È una chat. */
  avatar?: { face: string; color: string } | null;
  /**
   * CHAT DI GRUPPO — i membri della stanza, che nel topbar prendono il posto del volto singolo
   * (fila sovrapposta orizzontale). Una stanza non ha UN agente: mostrarne uno solo sceglierebbe
   * arbitrariamente un padrone del thread. Meno di due voci qui non è una stanza: si usa `avatar`.
   */
  avatars?: Array<{ id: string; name: string; face: string; color: string }> | null;
};

const empty: PageMeta = { title: null, subtitle: null, section: null, avatar: null, avatars: null };

/** Hub page title/subtitle for the global sticky top bar. */
export const pageMeta = writable<PageMeta>({ ...empty });

/** Optional right-side actions rendered inside the global top bar. */
export const pageTopActions = writable<Snippet | null>(null);

export function setPageMeta(meta: PageMeta) {
  const next = {
    title: meta.title,
    subtitle: meta.subtitle ?? null,
    section: meta.section ?? null,
    avatar: meta.avatar ?? null,
    avatars: meta.avatars?.length ? meta.avatars : null
  };
  // La pila si confronta per chiavi, non per identità dell'array: chi ci scrive lo ricostruisce
  // a ogni giro dell'effect, e senza questo il topbar si ridipingerebbe a ogni refresh dei thread.
  const stackKey = (m: PageMeta) => (m.avatars ?? []).map((a) => `${a.id}:${a.face}:${a.color}`).join('|');
  pageMeta.update((cur) =>
    cur.title === next.title &&
    cur.subtitle === next.subtitle &&
    cur.section === next.section &&
    cur.avatar?.face === next.avatar?.face &&
    cur.avatar?.color === next.avatar?.color &&
    stackKey(cur) === stackKey(next)
      ? cur
      : next
  );
}

export function clearPageMeta() {
  pageMeta.update((cur) =>
    cur.title === null && cur.subtitle === null && cur.section === null && !cur.avatar && !cur.avatars
      ? cur
      : { ...empty }
  );
  pageTopActions.update((cur) => (cur === null ? cur : null));
}
