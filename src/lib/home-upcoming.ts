import type { ScheduledBlogPreview, ScheduledPostPreview } from '$lib/server/hub-overview';

/**
 * COSA ESCE, in una fila sola.
 *
 * Prima erano due riquadri affiancati — «prossimi social» e «prossimi articoli» — ognuno col suo
 * titolo, il suo «vedi tutti» e la sua cornice. Ma nessuno chiede cosa esce sui social e poi cosa
 * esce sul blog: si chiede cosa esce, e la risposta è una fila in ordine di orologio.
 *
 * Come per `home-todos`, qui c'è solo la SELEZIONE e l'ORDINE: nessun testo, nessun brand nella
 * rotta. Le etichette e il prefisso `/app/<slug>` li mette la pagina.
 */

const TITLE_MAX = 90;

export type UpcomingKind = 'social' | 'blog';

export type UpcomingItem = {
  id: string;
  kind: UpcomingKind;
  /** Sotto `/app/<slug>`. */
  path: string;
  when: string;
  title: string | null;
  thumb: string | null;
  /** La sigla da mostrare quando la miniatura non c'è: la piattaforma, o `B` per un articolo. */
  fallback: string;
};

function clamp(text: string | null): string | null {
  const t = text?.trim();
  if (!t) return null;
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t;
}

export function upcomingFeed(
  posts: ScheduledPostPreview[],
  blogs: ScheduledBlogPreview[]
): UpcomingItem[] {
  const social: UpcomingItem[] = posts.map((p) => ({
    id: p.id,
    kind: 'social',
    path: '/calendar?status=scheduled',
    when: p.scheduled_for,
    title: clamp(p.caption),
    thumb: p.media_url,
    fallback: (p.platform ?? '?').slice(0, 2).toUpperCase()
  }));

  const articles: UpcomingItem[] = blogs.map((a) => ({
    id: a.id,
    kind: 'blog',
    path: `/site/edit/${a.id}`,
    when: a.scheduled_for,
    title: clamp(a.title),
    thumb: a.cover_url,
    fallback: 'B'
  }));

  return [...social, ...articles].sort((a, b) => a.when.localeCompare(b.when));
}
