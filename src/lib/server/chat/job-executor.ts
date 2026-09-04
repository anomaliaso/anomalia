/**
 * Shared executor for long-running chat tools.
 * Used inline by tool wrappers (await until done).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobCancellation } from '$lib/server/chat/job-cancel';
import { hasWebHub, isPaidPlan } from '$lib/server/plans';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const WEB_JOB_TOOLS = new Set(['seo_geo_audit', 'seo_plan', 'seo_add_initiatives']);

async function assertWebHubPaid(
  supabase: SupabaseClient,
  brandId: string
): Promise<AnyRec | null> {
  const { data } = await supabase.from('brands').select('plan').eq('id', brandId).maybeSingle();
  if (hasWebHub(data?.plan)) return null;
  return {
    error: 'Web hub (SEO, blog, library) is unavailable on this plan',
    locked: true
  };
}

/**
 * Every tool name the switch below actually handles.
 *
 * `chat_jobs` is a shared table: the designer enqueues its own pending rows there
 * (`motion_video`, `ugc_batch` — see enqueueDesignerContinuation) and they are drained by a
 * different worker entirely. A queue that claims rows by "not a chat turn" would swallow those,
 * hit the default case, and write `done` on a row whose real work never ran — silently killing a
 * motion session mid-generation. So the drain claims by allowlist: if this executor cannot run it,
 * it must not claim it. Keep this in step with the switch.
 */
export const EXECUTABLE_TOOL_JOBS = [
  'generate_strategy',
  'generate_editorial_plan',
  'generate_content',
  'produce_week',
  'create_campaign',
  'discover_competitors',
  'reanalyze_brand',
  'sync_social_history',
  'generate_person',
  'sync_products',
  'seo_geo_audit',
  'seo_plan',
  'seo_add_initiatives',
  'analytics_review',
  'run_autopilot',
  'subagent_run'
] as const;

/** Job che il drain serverless di Vercel non deve reclamare: solo il worker process. */
export const WORKER_ONLY_TOOL_JOBS = ['run_autopilot'] as const;

export async function executeChatToolJob(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  toolName: string,
  params: AnyRec,
  cancel: JobCancellation,
  /** La riga reclamata: serve a chi esegue il job e non vive nei params (thread, id per il mirror). */
  job?: { id?: string; thread_id?: string | null }
): Promise<AnyRec> {
  if (WEB_JOB_TOOLS.has(toolName)) {
    const locked = await assertWebHubPaid(supabase, brandId);
    if (locked) return locked;
  }

  const { genaiClient } = await import('$lib/server/brand-context');

  switch (toolName) {
    case 'generate_strategy': {
      await cancel.assertActive();
      const { runGenerateStrategy } = await import('$lib/server/chat/async-jobs');
      const result = await runGenerateStrategy(supabase, brandId, userId, params);
      await cancel.assertActive();
      return result;
    }

    case 'generate_editorial_plan': {
      await cancel.assertActive();
      const { runGenerateEditorialPlan } = await import('$lib/server/chat/async-jobs');
      const result = await runGenerateEditorialPlan(supabase, brandId, params);
      await cancel.assertActive();
      return result;
    }

    case 'generate_content':
    case 'produce_week': {
      await cancel.assertActive();
      const { runProduceWeek } = await import('$lib/server/chat/async-jobs');
      const result = await runProduceWeek(supabase, brandId, userId, {
        ...params,
        onboarding: toolName === 'generate_content' ? true : !!params.onboarding
      });
      await cancel.assertActive();
      return result;
    }

    case 'create_campaign': {
      await cancel.assertActive();
      const { runCreateCampaign } = await import('$lib/server/chat/async-jobs');
      const result = await runCreateCampaign(supabase, brandId, userId, params as {
        name: string;
        event_date: string;
        brief: string;
        platform?: string;
        tz?: string;
      });
      await cancel.assertActive();
      return result;
    }

    case 'discover_competitors': {
      const { discoverCompetitors, resolveCompetitorHandles, scrapeCompetitors, benchmarkCompetitors } = await import('$lib/server/research');
      const { scrapeForOnboarding, getBrandScrapeTargets } = await import('$lib/server/scrapecreators');
      const ai = genaiClient();

      const { data: kit } = await supabase.from('brand_kit').select('*').eq('brand_id', brandId).maybeSingle();
      const { data: brand } = await supabase.from('brands').select('name, website, target_platforms').eq('id', brandId).maybeSingle();
      const platforms: string[] = params.platforms ?? (brand?.target_platforms as string[]) ?? ['instagram'];
      const profile = { name: brand?.name ?? '', url: brand?.website, about: kit?.about, category: kit?.category, target_audience: kit?.target_audience };

      const targets = await getBrandScrapeTargets(supabase, brandId);
      const brandScrape = targets.length ? await scrapeForOnboarding(targets).catch(() => ({ posts: [], errors: [] })) : { posts: [], errors: [] };

      const discovered = await discoverCompetitors(ai, profile).catch(() => ({ competitors: [], citations: [] }));
      const competitors = discovered.competitors ?? [];
      if (!competitors.length) return { error: 'No competitors found' };

      const handleMap = await resolveCompetitorHandles(ai, competitors, platforms).catch(() => new Map());
      await cancel.assertActive();
      const competitorPosts = await scrapeCompetitors(handleMap);
      const benchmark = benchmarkCompetitors(brandScrape.posts, competitorPosts);

      await cancel.assertActive();
      for (const c of competitors) {
        await cancel.assertActive();
        const handles = handleMap.get(c.name) ?? [];
        const handlesObj: AnyRec = {};
        for (const h of handles) handlesObj[h.platform] = h.username ?? h.profileUrl;
        await supabase.from('competitors').upsert({
          brand_id: brandId, name: c.name, website: c.website, kind: c.kind, rationale: c.rationale, handles: handlesObj, source: 'ai'
        }, { onConflict: 'brand_id,name' });
      }

      const { writeResearchToMemory } = await import('$lib/server/brand-memory');
      const { synthesizeStrategyReport } = await import('$lib/server/research');
      try {
        const qual = await synthesizeStrategyReport(ai, profile, benchmark, '', platforms).catch(() => null);
        if (qual) await writeResearchToMemory(supabase, brandId, qual);
      } catch { /* best-effort */ }

      return {
        competitors_found: competitors.length,
        competitors: competitors.map((c) => ({ name: c.name, kind: c.kind, website: c.website })),
        benchmark: {
          brand_posts: benchmark.brand?.count ?? 0,
          market_median_engagement: benchmark.market?.medianEngagement ?? 0,
          competitors: benchmark.competitors.map((c) => ({ name: c.name, posts: c.stats.count, engagement: c.stats.medianEngagement }))
        }
      };
    }

    case 'reanalyze_brand': {
      const { runBrandAnalysis } = await import('$lib/server/brand-analysis');
      const { rebuildBrandContext } = await import('$lib/server/brand-context');
      const { data: brand } = await supabase.from('brands').select('website').eq('id', brandId).maybeSingle();
      const url = params.url ?? brand?.website;
      if (!url) return { error: 'No website URL found.' };

      await cancel.assertActive();
      const profile = await runBrandAnalysis(url, () => {});
      if (!profile) return { error: 'Brand analysis failed' };

      await cancel.assertActive();
      await supabase.from('brand_kit').upsert({
        brand_id: brandId,
        category: profile.category ?? null,
        about: profile.about ?? null,
        brand_style: profile.brand_style ?? null,
        target_audience: profile.target_audience ?? null,
        brand_colors: profile.brand_colors ?? null,
        theme_color: profile.theme_color ?? null,
        site_type: profile.site_type ?? null,
        content_pillars: profile.content_pillars ?? null,
        fonts: profile.fonts ?? null,
        logos: profile.logos ?? null,
        favicon_url: profile.favicon_url ?? null,
        images: profile.images ?? null
      }, { onConflict: 'brand_id' });

      if (profile.products?.length) {
        await supabase.from('products').delete().eq('brand_id', brandId);
        await supabase.from('products').insert(
          profile.products.map((p: AnyRec) => ({
            brand_id: brandId, title: p.name ?? p.title, description: p.description ?? '', pricing: p.pricing ?? null, kind: p.productType ?? p.kind ?? 'product', images: p.images ?? null, url: p.url ?? null
          }))
        );
      }

      await rebuildBrandContext(supabase, brandId);
      const { approveStudioIfNeeded } = await import('$lib/server/onboarding');
      const studio = await approveStudioIfNeeded(supabase, brandId);
      return {
        success: true,
        name: profile.name,
        category: profile.category,
        products_found: profile.products?.length ?? 0,
        site_type: profile.site_type,
        studio_approved: studio.approved || studio.already,
        instruction: studio.approved
          ? 'Studio auto-approved. Call generate_strategy next (then generate_editorial_plan). Do not ask the user for permission.'
          : undefined
      };
    }

    case 'sync_social_history': {
      const { materializeBrandHistory, getBrandScrapeTargets } = await import('$lib/server/scrapecreators');
      let targets = await getBrandScrapeTargets(supabase, brandId);
      if (params.platform) targets = targets.filter((t: AnyRec) => t.platform === params.platform.toLowerCase());
      if (!targets.length) return { error: 'No social accounts connected.' };

      const result = await materializeBrandHistory(supabase, brandId, targets);
      return { success: true, profiles_synced: result.accounts, posts_synced: result.synced, errors: result.errors };
    }

    case 'generate_person': {
      const { generateAiPersonImages, uploadPersonDataUrls } = await import('$lib/server/people');
      const { data: brand } = await supabase.from('brands').select('org_id').eq('id', brandId).maybeSingle();
      const ownerId = brand?.org_id ?? userId;

      let imageRefs: AnyRec[] = [];

      if (params.photo_urls?.length) {
        for (const url of params.photo_urls) {
          try {
            const res = await fetch(url, { signal: cancel.signal });
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            const mime = res.headers.get('content-type') ?? 'image/jpeg';
            const ext = mime.includes('png') ? 'png' : 'jpg';
            const path = `${ownerId}/${brandId}/people/${crypto.randomUUID()}.${ext}`;
            const { error: upErr } = await supabase.storage.from('brand-knowledge').upload(path, buf, { contentType: `image/${ext}`, upsert: false });
            if (!upErr) imageRefs.push({ path });
          } catch { /* skip */ }
        }
      } else {
        const images = await generateAiPersonImages({
          attributes: { gender: params.gender, ageRange: params.age_range },
          description: params.description ?? params.role ?? ''
        });
        if (!images.length) return { error: 'Failed to generate AI person images.' };
        imageRefs = await uploadPersonDataUrls(supabase, ownerId, brandId, images);
      }

      if (!imageRefs.length) return { error: 'No images processed.' };

      await cancel.assertActive();
      const kind = params.photo_urls?.length ? 'real' : 'ai';
      const { data: person, error } = await supabase.from('people').insert({
        brand_id: brandId, name: params.name, role: params.role ?? 'Team Member', kind, description: params.description ?? '', images: imageRefs
      }).select('id, name, role, kind').maybeSingle();
      if (error) return { error: error.message };

      return { success: true, person_id: person?.id, name: person?.name, kind: person?.kind, images_count: imageRefs.length };
    }

    case 'sync_products': {
      const { isShopifySite, fetchShopifyProducts, isWooCommerceSite, fetchWooCommerceProducts } = await import('$lib/server/brand-analysis');
      const { data: brand } = await supabase.from('brands').select('website').eq('id', brandId).maybeSingle();
      if (!brand?.website) return { error: 'No website URL set.' };

      await cancel.assertActive();
      const res = await fetch(brand.website, { signal: cancel.signal });
      const html = await res.text();

      let products: AnyRec[] = [];
      if (isShopifySite(html)) products = await fetchShopifyProducts(brand.website);
      else if (isWooCommerceSite(html)) products = await fetchWooCommerceProducts(brand.website);
      else return { error: 'No e-commerce platform detected.' };

      if (!products.length) return { error: 'No products found.' };

      await cancel.assertActive();
      await supabase.from('products').delete().eq('brand_id', brandId);
      await supabase.from('products').insert(
        products.map((p) => ({
          brand_id: brandId, title: p.name, description: p.description ?? '', pricing: p.pricing ?? null, kind: p.productType ?? 'product', images: p.images ?? null, url: p.url ?? null
        }))
      );

      return { success: true, platform: isShopifySite(html) ? 'Shopify' : 'WooCommerce', products_synced: products.length };
    }

    case 'generate_video': {
      // Un video da zero SENZA post. Il render vive fuori dal turno perche' impiega minuti, e la
      // clip finita atterra in libreria: e' l'unico posto da cui un altro tool sa riprenderla
      // (create_post_from_asset). Un mp4 pagato che non entra in libreria non e' raggiungibile da
      // nulla, ed e' esattamente il difetto che questo caso esiste per non ripetere.
      const { renderVideo } = await import('$lib/server/video');
      const { saveRenderedVideoToLibrary } = await import('$lib/server/brand-media');
      const { data: brand } = await supabase
        .from('brands')
        .select('content_prefs')
        .eq('id', brandId)
        .maybeSingle();
      const prefs = (brand?.content_prefs ?? {}) as AnyRec;
      const brief = String(params.brief ?? '').trim();
      if (!brief) return { error: 'generate_video needs a brief' };

      const out = await renderVideo(supabase, userId, brief, {
        prefs,
        model: typeof params.model === 'string' ? params.model : undefined,
        duration: typeof params.duration === 'number' ? params.duration : undefined,
        aspectRatio: (typeof params.aspect_ratio === 'string' ? params.aspect_ratio : '9:16') as '1:1' | '9:16' | '16:9',
        imageUrl: typeof params.image_url === 'string' ? params.image_url : undefined,
        prompt: brief,
        resolution: typeof prefs.videoResolution === 'string' ? prefs.videoResolution : undefined
      });
      if (!out?.url) return { error: 'The render returned nothing. A job that did not finish was not billed.' };

      const saved = await saveRenderedVideoToLibrary(supabase, {
        brandId,
        userId,
        url: out.url,
        title: brief.slice(0, 80),
        durationSeconds: out.durationSeconds
      });
      return {
        video_url: out.url,
        duration_seconds: out.durationSeconds,
        ...('mediaId' in saved
          ? { media_id: saved.mediaId, hint: 'Pass media_id to create_post_from_asset(type:"video") to publish it.' }
          : { library_error: saved.error, hint: 'The clip exists at video_url but is NOT in the library — say so rather than promising it is reusable.' })
      };
    }

    case 'seo_geo_audit': {
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { geoTickForBrand } = await import('$lib/server/geo');
      const { data: brand } = await supabase.from('brands').select('id, name, website, content_prefs').eq('id', brandId).maybeSingle();
      if (!brand) return { error: 'Brand not found' };
      const snap = await geoTickForBrand(createAdminClient(), brand);
      if (!snap) return { error: 'Audit failed — site unreachable or no prompts' };
      return { tech_score: snap.techScore, share_of_voice: snap.shareOfVoice, issues: snap.issues.length, gaps: snap.citations.filter((c: AnyRec) => !c.brandMentioned).length };
    }

    case 'seo_plan': {
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { generateSeoPlan } = await import('$lib/server/seo-advisor');
      const { data: brand } = await supabase.from('brands').select('id, name, website, content_prefs').eq('id', brandId).maybeSingle();
      if (!brand) return { error: 'Brand not found' };
      const plan = await generateSeoPlan(createAdminClient(), brand);
      if (!plan) return { error: 'Could not generate the SEO plan' };
      return { grade: plan.evaluation.grade, initiatives: plan.initiatives.length };
    }

    case 'seo_add_initiatives': {
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { addSeoInitiatives } = await import('$lib/server/seo-advisor');
      const { data: brand } = await supabase.from('brands').select('id, name, website, content_prefs').eq('id', brandId).maybeSingle();
      if (!brand) return { error: 'Brand not found' };
      const fresh = await addSeoInitiatives(createAdminClient(), brand, { guidance: params.guidance });
      if (!fresh?.length) return { error: 'Could not add initiatives' };
      return { added: fresh.length, titles: fresh.map((i) => i.title) };
    }

    case 'analytics_review': {
      if (!isPaidPlan((await supabase.from('brands').select('plan').eq('id', brandId).maybeSingle()).data?.plan)) {
        return { error: 'Analytics review requires a Starter or Pro plan', locked: true };
      }
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { analyticsReviewAgentEnabled, runAnalyticsReviewAgent } = await import(
        '$lib/server/analytics-review-agent'
      );
      if (!analyticsReviewAgentEnabled()) {
        return { error: 'Analytics review agent is disabled' };
      }
      const admin = createAdminClient();
      const { data: brand } = await admin
        .from('brands')
        .select('id, name, slug, website, content_prefs, plan, timezone, target_platforms')
        .eq('id', brandId)
        .maybeSingle();
      if (!brand) return { error: 'Brand not found' };
      await cancel.assertActive();
      const result = await runAnalyticsReviewAgent({
        supabase: admin,
        brand,
        guidance: typeof params.guidance === 'string' ? params.guidance : undefined,
        mode: 'on_demand',
        userId,
        deadlineMs: 240_000
      });
      await cancel.assertActive();
      if (!result) return { error: 'Analytics review produced no result' };
      return {
        notes: result.notes,
        actions: result.actions,
        actions_count: result.actions.length,
        cost_usd: result.costUsd
      };
    }


    case 'run_autopilot': {
      const { data: brand } = await supabase
        .from('brands')
        .select(
          'id, name, slug, plan, timezone, target_platforms, content_prefs, autopilot_failure_count, org_id, last_autopilot_run_at, activated_at, zernio_profile_id, blog_config'
        )
        .eq('id', brandId)
        .maybeSingle();
      if (!brand) return { error: 'Brand not found' };
      await cancel.assertActive();
      const { runAutopilotForBrand } = await import('$lib/server/scheduler');
      const deadlineMs =
        typeof params.deadline_ms === 'number' && params.deadline_ms > 0 ? params.deadline_ms : 3_600_000;
      const res = await runAutopilotForBrand(supabase, brand, { deadlineMs });
      await cancel.assertActive();
      if (res.ran) {
        const { reportToAgentThread } = await import('$lib/server/team-ignition');
        await reportToAgentThread(supabase, brandId, {
          job: 'autopilot',
          postsCreated: res.postsCreated ?? 0,
          emailed: res.emailed ?? false,
          ...(res.planned ? { planned: true } : {})
        });
      }
      return res;
    }

    case 'subagent_run': {
      // La run di un sub-agent accodata da delegate_task / run_task_pipeline / run_parallel_tasks.
      // Il mirror del partial e la deadline sono di subagent-jobs.ts; il rientro del risultato lo
      // fa il drain che ci chiama, con lo stesso meccanismo degli altri tool lunghi.
      const { runSubagentJob } = await import('$lib/server/chat/subagent-jobs');
      if (!job?.id) return { error: 'subagent_run without a job row' };
      return runSubagentJob(supabase, { id: job.id, brand_id: brandId, user_id: userId, thread_id: job.thread_id }, params, cancel);
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
