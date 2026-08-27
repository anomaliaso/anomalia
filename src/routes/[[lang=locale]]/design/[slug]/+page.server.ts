/**
 * One post's page — the long tail, and the only place the full grade is shown.
 *
 * 404 rather than a redirect when a slug stops qualifying: a post pulled from the wall (a takedown,
 * a rubric change) must stop existing as a URL, and a 301 to the index would keep it alive in every
 * search index that had already crawled it.
 */
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { getWallCard, listDesignWall } from '$lib/server/wall';
import type { Locale } from '$lib/i18n/locale';

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
  const admin = createAdminClient();
  const locale = (locals.locale ?? 'en') as Locale;

  const card = await getWallCard(admin, params.slug, locale);
  if (!card) throw error(404, 'not found');

  // A handful of neighbours, so the page is a way into the wall rather than a dead end. Filtered by
  // the card's own first tag when it has one — "more like this" is worth more than "more".
  const related = await listDesignWall(admin, { locale, tag: card.tags[0] ?? null, limit: 8 });

  setHeaders({ 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' });

  return { card, related: related.cards.filter((c) => c.slug !== card.slug).slice(0, 6) };
};
