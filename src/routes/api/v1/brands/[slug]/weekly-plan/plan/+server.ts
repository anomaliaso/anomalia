import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { normalizeContentFormat } from '$lib/content-formats';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const body = await request.json();
  const week_index = body.week_index ?? body.week;
  if (week_index === undefined) return json({ error: 'week_index is required' }, { status: 400 });

  try {
    const { planWeekStrategy, carouselMaxPerBatch, loadPlannerMarketSignals } = await import('$lib/server/content-preview');
    const { weekStrategyBrief, postsForWeek, selectFeaturableProducts } = await import('$lib/server/editorial-plan');
    const { attachBrandPages } = await import('$lib/server/content-library');

    // Build profile from brand_kit + products (mirrors scheduler.ts)
    const { data: kit } = await supabase
      .from('brand_kit')
      .select('category, about, target_audience, brand_colors, ai_character, ai_context, visual_style, site_type, content_pillars, logos, fonts, theme_color')
      .eq('brand_id', brand.id)
      .maybeSingle();

    // Load ALL products, then pick the substantial, photogenic heroes spread across categories.
    const { data: rawProducts } = await supabase
      .from('products')
      .select('title, description, kind, pricing, images')
      .eq('brand_id', brand.id);

    const products = selectFeaturableProducts(rawProducts ?? [], 40);

    const profile: any = {
      name: brand.name,
      category: kit?.category ?? '',
      about: kit?.about ?? '',
      target_audience: kit?.target_audience ?? '',
      brand_colors: kit?.brand_colors ?? [],
      ai_character: kit?.ai_character ?? {},
      ai_context: kit?.ai_context ?? '',
      visual_style: kit?.visual_style ?? '',
      site_type: kit?.site_type ?? 'generic',
      content_pillars: kit?.content_pillars ?? [],
      logos: kit?.logos ?? [],
      fonts: kit?.fonts ?? [],
      theme_color: kit?.theme_color ?? null,
      products: (products ?? []).map((p: any) => ({
        name: p.title,
        description: p.description,
        kind: p.kind,
        pricing: p.pricing,
        images: p.images
      }))
    };

    // Linkable site pages (content library) → real URLs for Reddit link posts + topic hooks.
    await attachBrandPages(profile, supabase, brand.id).catch(swallow('attach brand pages'));

    // Load editorial plan for strategy brief and platform mix
    const { data: editorialPlan } = await supabase
      .from('editorial_plans')
      .select('*')
      .eq('brand_id', brand.id)
      .eq('status', 'active')
      .maybeSingle();

    // Approved rubrics ([] for brands that haven't adopted them → pre-rubric behaviour).
    const { loadApprovedRubrics } = await import('$lib/server/rubrics');
    const rubrics = await loadApprovedRubrics(supabase, brand.id).catch((error) => { swallow('load approved rubrics', error); return []; });

    const strategyBrief = editorialPlan ? weekStrategyBrief(editorialPlan as any, week_index, rubrics) : '';
    const count = editorialPlan ? postsForWeek(editorialPlan as any, week_index) : 3;

    // Derive platforms from the GTM plan's current phase platform_weights.
    // The editorial plan weeks don't carry platform_weights — those live on the GTM phases.
    const { data: gtmPlan } = await supabase
      .from('gtm_plans')
      .select('phases')
      .eq('brand_id', brand.id)
      .eq('status', 'active')
      .maybeSingle();

    // Use the first phase (Fondamenta) for platform weights — there's no current_phase column.
    const currentPhase = (gtmPlan as any)?.phases?.[0];
    const platformWeights: { platform: string; percent: number }[] = currentPhase?.platform_weights ?? [];

    let platforms = platformWeights.map((pw: any) => pw.platform);
    if (!platforms.length) {
      // Fallback: user's connected social accounts
      const { data: accounts } = await supabase
        .from('social_accounts')
        .select('platform')
        .eq('brand_id', brand.id)
        .eq('status', 'active');
      platforms = (accounts ?? []).map((a: any) => a.platform);
    }
    if (!platforms.length) platforms = ['instagram'];

    // Enrich strategy brief with EXACT per-platform post counts (percentages alone are too vague
    // for small batches — "80/20 on 3 posts" leaves the AI guessing; tell it exactly how many).
    let platformDirective = '';
    if (platformWeights.length > 1 && count > 1) {
      const allocation: { platform: string; count: number }[] = [];
      let assigned = 0;
      for (const pw of platformWeights) {
        const n = Math.max(1, Math.round((pw.percent / 100) * count));
        allocation.push({ platform: pw.platform, count: n });
        assigned += n;
      }
      // Adjust for rounding: give the extra post to the dominant platform
      if (assigned !== count && allocation.length > 0) {
        allocation[0].count += count - assigned;
      }
      const lines = allocation.filter(a => a.count > 0).map(a => `- ${a.count}× ${a.platform}`);
      platformDirective = `\nPLATFORM DISTRIBUTION (authoritative — you MUST produce exactly these counts, do NOT put all posts on one platform):\n${lines.join('\n')}`;
    }
    const enrichedBrief = strategyBrief + platformDirective;

    const { marketBrief, competitorThumbUrls } = await loadPlannerMarketSignals(supabase, brand.id);

    const result = await planWeekStrategy(
      profile,
      {
        platforms,
        strategyBrief: enrichedBrief,
        maxCarousels: carouselMaxPerBatch(),
        rubrics,
        supabase,
        brandId: brand.id,
        weekIndex: week_index,
        marketBrief,
        competitorThumbUrls
      },
      count
    );

    // POST-PROCESS: force platform distribution to match GTM weights.
    // Gemini often ignores the platform spread directive, so we reassign seeds after generation.
    if (platformWeights.length > 1 && result.seeds?.length > 1) {
      // Build target allocation: e.g. 3 posts, 80/20 → {instagram: 2, x: 1}
      const target: Record<string, number> = {};
      let remaining = count;
      for (let i = 0; i < platformWeights.length; i++) {
        const pw = platformWeights[i];
        const n = i === platformWeights.length - 1
          ? remaining
          : Math.max(1, Math.round((pw.percent / 100) * count));
        target[pw.platform] = n;
        remaining -= n;
      }

      // Count current distribution
      const current: Record<string, number> = {};
      for (const seed of result.seeds) {
        const p = (seed.platform ?? '').toLowerCase();
        current[p] = (current[p] ?? 0) + 1;
      }

      // Find platforms that need more posts (deficit) and platforms that have too many (surplus)
      const deficit: string[] = [];
      const surplus: string[] = [];
      for (const plat of platforms) {
        const want = target[plat] ?? 0;
        const have = current[plat] ?? 0;
        if (have < want) {
          for (let i = 0; i < want - have; i++) deficit.push(plat);
        } else if (have > want) {
          for (let i = 0; i < have - want; i++) surplus.push(plat);
        }
      }

      // Reassign surplus seeds to deficit platforms (swap last surplus seed to first deficit)
      while (deficit.length && surplus.length) {
        const toPlatform = deficit.shift()!;
        const fromPlatform = surplus.shift()!;
        // Find last seed on the surplus platform
        for (let i = result.seeds.length - 1; i >= 0; i--) {
          if ((result.seeds[i].platform ?? '').toLowerCase() === fromPlatform) {
            result.seeds[i].platform = toPlatform;
            result.seeds[i].platforms = [toPlatform];
            // Adapt format: X doesn't support carousels
            if (toPlatform === 'x' && normalizeContentFormat(result.seeds[i].format) === 'carousel') {
              result.seeds[i].format = 'single_image';
            }
            break;
          }
        }
      }
    }

    // Store as draft in content_plans
    const { error: draftErr } = await supabase.from('content_plans').insert({
      brand_id: brand.id,
      title: `CLI · ${new Date().toISOString().slice(0, 10)}`,
      source: 'manual',
      status: 'draft',
      seeds: result,
      editorial_plan_id: editorialPlan?.id ?? null,
      editorial_week: week_index
    });
    if (draftErr) return json({ error: draftErr.message }, { status: 500 });

    return json({ ok: true, draft: result });
  } catch (e) {
    return json({ error: `Plan failed: ${String(e)}` }, { status: 500 });
  }
};
