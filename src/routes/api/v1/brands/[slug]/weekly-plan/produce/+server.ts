import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  // AI-spending action — requires a paid plan with credits (same standard as /seo, /geo, /web).
  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const { draft_id, row_index } = await request.json();
  if (!draft_id) return json({ error: 'draft_id is required' }, { status: 400 });

  try {
    const { loadGrowthReadiness, growthReadinessMessage } = await import('$lib/server/growth-readiness');
    const growth = await loadGrowthReadiness(supabase, brand.id);
    if (!growth.ready) {
      return json(
        {
          error: 'growth_data_incomplete',
          message: growthReadinessMessage(growth),
          checks: growth.checks,
          ready: false
        },
        { status: 422 }
      );
    }

    // Load the draft
    const { data: draft } = await supabase
      .from('content_plans').select('*')
      .eq('id', draft_id).eq('brand_id', brand.id).maybeSingle();

    if (!draft) return json({ error: 'Draft not found' }, { status: 404 });

    // seeds can be a flat array or a WeeklyStrategy object {seeds: [...], theme: ...}
    const rawSeeds = draft.seeds;
    const seeds: Record<string, unknown>[] = Array.isArray(rawSeeds)
      ? rawSeeds
      : Array.isArray((rawSeeds as any)?.seeds)
        ? (rawSeeds as any).seeds
        : [];
    const targetSeeds = row_index !== undefined ? [seeds[row_index]] : seeds;

    if (!targetSeeds.length) return json({ error: 'No seeds to produce' }, { status: 400 });

    // Build profile (mirrors scheduler.ts and plan route)
    const { data: kit } = await supabase
      .from('brand_kit')
      .select('category, about, target_audience, brand_colors, ai_character, ai_context, visual_style, site_type, content_pillars, logos, fonts, theme_color')
      .eq('brand_id', brand.id)
      .maybeSingle();

    // Load ALL products so resolveOffering matches the featured product for image references.
    const { data: products } = await supabase
      .from('products')
      .select('title, description, kind, pricing, images')
      .eq('brand_id', brand.id);

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

    // Import generate logic
    const { executeWeekStrategy, carouselMaxPerBatch, postQcPayload } = await import('$lib/server/content-preview');

    // Build WeeklyStrategy from the seeds
    const strategy = {
      theme: (rawSeeds as any)?.theme ?? '',
      rationale: (rawSeeds as any)?.rationale ?? '',
      doDont: (rawSeeds as any)?.doDont ?? '',
      seeds: targetSeeds
    };

    // Execute: generate captions + image prompts for each seed. No videos here (this route never
    // renders), but carousels keep their slide prompts within the batch budget so the render
    // step can produce the full series.
    const posts = await executeWeekStrategy(profile, strategy as any, {}, 0, carouselMaxPerBatch(), {
      supabase,
      brandId: brand.id,
      userId: user!.id
    });

    // Insert posts into the posts table. Fields come from the produced POST (built from the
    // normalised seeds inside executeWeekStrategy), not the raw stored seed — so legacy formats
    // are already mapped onto the ContentFormat enum and row filtering can't misalign the zip.
    let produced = 0;
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      if (!post) continue;

      try {
        const { data: row, error: insertError } = await supabase
          .from('posts')
          .insert({
            brand_id: brand.id,
            platform: post.platform,
            platforms: post.platforms ?? [post.platform],
            caption: post.caption,
            image_prompt: post.image_prompt,
            // Carousel slide prompts persist with the post so the (separate) render step can
            // produce the whole series — this route writes captions only, no images.
            image_prompts: post.image_prompts?.length ? post.image_prompts : null,
            pillar: post.pillar,
            rubric_id: post.rubricId ?? null,
            // Deviazione di scena dichiarata dal produttore (contratto a due livelli).
            qc: postQcPayload(post),
            format: post.format,
            content_type: post.media === 'text' ? 'text' : 'image',
            status: 'pending_user',
            plan_id: draft_id,
            product_name: post.product || null,
            // Produce-agent loop may already have rendered + reviewed images.
            ...(post.imageUrl ? { media_url: post.imageUrl } : {}),
            ...(post.imageUrls && post.imageUrls.length > 1 ? { media_urls: post.imageUrls } : {})
          })
          .select('id')
          .single();
        if (insertError) {
          console.error(`Failed to insert post: ${insertError.message}`);
        } else {
          produced++;
          if (row?.id && post.knowledgeChunkIds?.length) {
            try {
              const { recordChunkUsedByPost } = await import('$lib/server/knowledge');
              await recordChunkUsedByPost(supabase, brand.id, row.id as string, post.knowledgeChunkIds);
            } catch (e) {
              console.warn('[produce] recordChunkUsedByPost', e instanceof Error ? e.message : e);
            }
          }
        }
      } catch (e) {
        console.error(`Failed to produce seed: ${String(e)}`);
      }
    }

    // Mark draft as produced
    await supabase.from('content_plans').update({ status: 'produced' }).eq('id', draft_id);

    return json({ ok: true, produced });
  } catch (e) {
    return json({ error: `Produce failed: ${String(e)}` }, { status: 500 });
  }
};
