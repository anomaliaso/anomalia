/**
 * The design wall's data.
 *
 * Reads through `wall.ts` and never touches `market_posts` directly — that module is the whitelist,
 * and a page that bypassed it would publish whatever column someone adds next month.
 *
 * PAGINATION IS A LINK, NOT A FETCH. `?page=2` is a real URL that renders server-side, so the wall
 * is crawlable past its first screen and works with JavaScript off. That is the entire reason this
 * page exists — an infinite scroll would hide 90% of the corpus from the only visitor that matters
 * to a traffic page.
 */
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { listDesignWall, designTagCounts, PAGE_SIZE } from '$lib/server/wall';
import { DESIGN_TAGS, WALL_PLATFORMS } from '$lib/wall';
import type { Locale } from '$lib/i18n/locale';

export const load: PageServerLoad = async ({ url, locals, setHeaders }) => {
  const admin = createAdminClient();

  // Query parameters are public input: anything not in the fixed vocabulary becomes null rather than
  // reaching a query. A filter that silently ignores junk is also a filter nobody can probe.
  const rawTag = url.searchParams.get('tag');
  const tag = rawTag && (DESIGN_TAGS as readonly string[]).includes(rawTag) ? rawTag : null;
  const rawPlatform = url.searchParams.get('platform');
  const platform = rawPlatform && (WALL_PLATFORMS as readonly string[]).includes(rawPlatform) ? rawPlatform : null;
  const pageNo = Math.min(50, Math.max(1, Number(url.searchParams.get('page')) || 1));

  const locale = (locals.locale ?? 'en') as Locale;

  const [wall, tags] = await Promise.all([
    listDesignWall(admin, { locale, tag, platform, limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE }),
    designTagCounts(admin)
  ]);

  // The wall changes a few times a day at most, and every visitor gets the same page — so it is
  // cached at the edge and revalidated in the background. A gallery that hits the database once per
  // visitor is a gallery that falls over the day it works.
  setHeaders({ 'cache-control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400' });

  return { cards: wall.cards, hasMore: wall.hasMore, tags, tag, platform, page: pageNo };
};
