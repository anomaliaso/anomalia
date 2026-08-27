import { swallow } from '$lib/server/swallow';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { normalizeStrategy, type KeywordStrategy } from '$lib/server/seo-keyword-strategy';
import { cachedBrandPage } from '$lib/server/page-cache';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~180s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 180 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    // RLS allows SELECT for brand members after migration 0110; admin still writes.
    const { data } = await supabase
      .from('brand_seo_keyword_strategy')
      .select('strategy, citations, updated_at')
      .eq('brand_id', brand.id)
      .maybeSingle();

    const strategy = normalizeStrategy((data?.strategy as KeywordStrategy) ?? null);

    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { loadRankBoard, ensureTrackedSet } = await import('$lib/server/rank-tracker');
    const { loadGscSummary } = await import('$lib/server/gsc');
    const admin = createAdminClient();
    await ensureTrackedSet(admin, brand).catch((error) => { swallow('ensure tracked set', error); return 0; });
    const [ranks, gsc] = await Promise.all([
      loadRankBoard(admin, brand.id),
      loadGscSummary(admin, brand.id)
    ]);

    const { isGscGateEnabled } = await import('$lib/server/feature-flags');
    const { gscReadyFromSummary } = await import('$lib/server/gsc');
    return {
      strategy,
      citations: (data?.citations as Array<{ uri: string; title: string }>) ?? [],
      updatedAt: data?.updated_at ?? null,
      ranks,
      gsc,
      gscGate: isGscGateEnabled(),
      gscReady: gscReadyFromSummary(gsc)
    };
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandBySlug(supabase: any, slug: string) {
  const { data } = await supabase.from('brands').select('id').eq('slug', slug).maybeSingle();
  return data;
}

export const actions: Actions = {
  refresh: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    return withBrandContext(brand.id, async () => {
      const { data: full } = await supabase
        .from('brands')
        .select('id, name, website, content_prefs, plan')
        .eq('id', brand.id)
        .maybeSingle();
      if (!full) return fail(404, { error: 'Brand not found' });
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { ensureKeywordStrategy } = await import('$lib/server/seo-keyword-strategy');
      const strategy = await ensureKeywordStrategy(createAdminClient(), full, { force: true });
      if (!strategy) return fail(502, { error: 'Could not generate keyword research' });
      return { refreshed: true };
    });
  },
  checkRanks: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const { data: full } = await supabase
      .from('brands')
      .select('id, name, website, plan, content_prefs')
      .eq('id', brand.id)
      .maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { checkBrandBatch } = await import('$lib/server/rank-tracker');
    await checkBrandBatch(createAdminClient(), full);
    return { ranksChecked: true };
  },
  addKeyword: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const keyword = String(fd.get('keyword') ?? '').trim();
    if (!keyword) return fail(400, { error: 'Keyword required' });
    const { data: full } = await supabase
      .from('brands')
      .select('id, name, website, plan, content_prefs')
      .eq('id', brand.id)
      .maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { ensureTrackedSet } = await import('$lib/server/rank-tracker');
    await ensureTrackedSet(createAdminClient(), full, { keywords: [keyword], source: 'manual' });
    return { added: true };
  }
};
