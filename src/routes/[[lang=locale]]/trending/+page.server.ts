/**
 * The trending wall's data. Same posture as the design wall — see the header there.
 *
 * The shorter cache is the one difference that matters: this page's claim is that it is current, and
 * the sweep runs hourly.
 */
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { listTrendingWall, PAGE_SIZE } from '$lib/server/wall';
import { WALL_PLATFORMS } from '$lib/wall';
import type { Locale } from '$lib/i18n/locale';

export const load: PageServerLoad = async ({ url, locals, setHeaders }) => {
  const admin = createAdminClient();

  const rawPlatform = url.searchParams.get('platform');
  const platform = rawPlatform && (WALL_PLATFORMS as readonly string[]).includes(rawPlatform) ? rawPlatform : null;
  const pageNo = Math.min(50, Math.max(1, Number(url.searchParams.get('page')) || 1));

  const locale = (locals.locale ?? 'en') as Locale;
  const wall = await listTrendingWall(admin, {
    locale,
    platform,
    limit: PAGE_SIZE,
    offset: (pageNo - 1) * PAGE_SIZE
  });

  setHeaders({ 'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600' });

  return { cards: wall.cards, hasMore: wall.hasMore, platform, page: pageNo };
};
