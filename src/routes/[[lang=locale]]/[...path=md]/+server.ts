import { error } from '@sveltejs/kit';
import { htmlToMarkdown } from '$lib/server/knowledge';
import type { RequestHandler } from './$types';

/**
 * Markdown mirror of any public page: append `.md` to its URL.
 *   /docs/api → /docs/api.md      /it/docs/radar → /it/docs/radar.md
 *
 * The pages are Svelte + i18n, so the markdown is derived from the SSR'd HTML rather than kept
 * as a second source of truth — a new docs page is mirrored the moment it exists, with no
 * duplicate content to keep in sync.
 */
export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
  const pagePath = `${params.lang ? `/${params.lang}` : ''}/${params.path.slice(0, -3)}`;

  // Deliberately the global fetch, not event.fetch: no cookies. The locale has to come from the
  // path alone (hooks.server.ts otherwise falls back to the `locale` cookie), or the single
  // shared CDN entry for /docs/api.md ends up in whatever language the first visitor had.
  const res = await globalThis.fetch(new URL(pagePath, url.origin), {
    headers: { 'accept-language': params.lang ?? 'en' }
  });
  if (!res.ok) error(res.status === 404 ? 404 : 502, 'Page not available as markdown');

  // ponytail: regex slice, not a DOM parse — one <main> per page and no nested ones. If a layout
  // ever nests <main>, switch to a parser.
  const body = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(await res.text())?.[1];
  if (!body) error(404, 'Page not available as markdown');

  const markdown = await htmlToMarkdown(body);
  setHeaders({ 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' });
  return new Response(`${markdown}\n\n---\nSource: ${url.origin}${pagePath}\n`, {
    headers: { 'content-type': 'text/markdown; charset=utf-8' }
  });
};
