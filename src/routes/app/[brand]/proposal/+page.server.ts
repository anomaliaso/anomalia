import type { PageServerLoad } from './$types';
import { cachedBrandPage } from '$lib/server/page-cache';

// The onboarding PROOF page: a read-only review of everything the background pipeline generated
// (strategy report, competitors, the first posts, the editorial plan), ending in the activation CTA.
// This is the destination of the recap email's "continue" link — the conversion centrepiece, now
// shown asynchronously after generation instead of live in the wizard. The [brand] layout's paywall
// allowlists this path so an unactivated brand can reach it.
export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const url = event.url;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const [{ data: strategy }, { data: competitors }, { data: plan }, { data: posts }] = await Promise.all([
      supabase.from('brand_strategy').select('report, citations').eq('brand_id', brand.id).maybeSingle(),
      supabase
        .from('competitors')
        .select('name, website, kind, rationale')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('editorial_plans')
        .select('strategy, cadence, platform_mix, weeks, gtm')
        .eq('brand_id', brand.id)
        .eq('status', 'active')
        .maybeSingle(),
      supabase
        .from('posts')
        .select('platform, caption, media_url, content_type, slot, format')
        .eq('brand_id', brand.id)
        .eq('source', 'plan')
        .order('created_at', { ascending: true })
    ]);

    // Carry the picked tier/cycle through to the activation CTA.
    const params = new URLSearchParams();
    const planTier = url.searchParams.get('plan');
    const cycle = url.searchParams.get('cycle');
    if (planTier) params.set('plan', planTier);
    if (cycle) params.set('cycle', cycle);

    const report = strategy?.report ?? null;
    const postRows = posts ?? [];

    return {
      report,
      citations: (strategy?.citations as { uri: string; title: string }[] | null) ?? [],
      competitors: competitors ?? [],
      plan: plan ?? null,
      posts: postRows,
      activateUrl: `/app/${brand.slug}/activate${params.toString() ? `?${params}` : ''}`,
      // Nothing generated yet → the user landed here before the pipeline finished.
      stillGenerating: !report && postRows.length === 0
    };
  }, [url.searchParams.get('plan'), url.searchParams.get('cycle')].join('|'));
};
