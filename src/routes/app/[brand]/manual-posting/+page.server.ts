import type { PageServerLoad } from './$types';
import { remaining } from '$lib/server/usage';
import { listBrandMedia } from '$lib/server/brand-media';
import { zonedClock } from '$lib/server/schedule';
import { cachedBrandPage } from '$lib/server/page-cache';

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const tz = brand.timezone ?? 'Europe/Rome';

    const [{ data: accts }, library, budget] = await Promise.all([
      supabase.from('social_accounts').select('platform').eq('brand_id', brand.id).eq('status', 'active'),
      listBrandMedia(supabase, brand.id, { status: 'ready', limit: 24 }),
      remaining(supabase, brand.id, brand.plan, tz)
    ]);

    const connectedPlatforms = [
      ...new Set((accts ?? []).map((a) => (a.platform ?? '').toLowerCase()).filter(Boolean))
    ];
    const targetPlatforms = [
      ...new Set([
        ...(Array.isArray(brand.target_platforms)
          ? (brand.target_platforms as string[]).map((p) => String(p).toLowerCase())
          : []),
        ...connectedPlatforms
      ])
    ];

    const clock = zonedClock(tz);
    const inAnHour = zonedClock(tz, new Date(Date.now() + 60 * 60 * 1000));

    return {
      connectedPlatforms,
      targetPlatforms,
      timezone: tz,
      todayKey: clock.date,
      nowISO: clock.utcIso,
      defaultDate: inAnHour.date,
      defaultTime: inAnHour.time,
      creditsRemaining: budget.credits.remaining,
      library: library
        .filter((m) => m.kind === 'image')
        .map((m) => ({
          id: m.id,
          url: m.signed_url || m.url,
          title: m.title
        }))
    };
  });
};
