import { swallow } from '$lib/server/swallow';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { wallClockToUtc } from '$lib/server/schedule';
import { blogArticlesPerWeek, blogArticlesPerWeekMax } from '$lib/server/plans';
import {
  brandBySlug,
  loadBlogSettingsData,
  toggleBlog
} from '$lib/server/blog-settings';
import { readUploadImage } from '$lib/server/raster-image';
import { cachedBrandPage } from '$lib/server/page-cache';

// The blog crawl/generation can take a while (grounded AI). Give the actions room.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const params = event.params;
  const url = event.url;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const [{ data: articles }, settings] = await Promise.all([
      supabase
        .from('brand_articles')
        .select('id, slug, title, status, cover_image, published_at, scheduled_for, body_md, meta_title, meta_description, category_id')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false }),
      loadBlogSettingsData(brand, url, supabase)
    ]);

    const { scoreArticle } = await import('$lib/server/article-score');
    const scored = (articles ?? []).map((a) => {
      const { body_md, meta_title, meta_description, ...rest } = a;
      const s = scoreArticle(
        { bodyMd: body_md ?? '', metaTitle: meta_title, metaDescription: meta_description, status: a.status },
        brand.website
      );
      return {
        ...rest,
        score: s.score,
        metrics: s.metrics,
        angle: a.status === 'planned' ? (meta_description ?? null) : null
      };
    });

    return {
      ...settings,
      articles: scored,
      draftCount: (articles ?? []).filter((a) => a.status !== 'published' && a.status !== 'planned').length,
      timezone: brand.timezone
    };
  });
};

export const actions: Actions = {
  // Turn one month-plan placeholder into a full draft right now, without waiting for its day.
  generateNow: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const { generatePlannedArticle } = await import('$lib/server/blog-generate');
    const newId = await generatePlannedArticle(createAdminClient(), brand, id, { skipNotify: true });
    if (!newId) return fail(502, { error: 'generation_failed' });
    return { generated: true };
  },

  // Publish every draft article to the site in one go. Also pushes them to Shopify if connected.
  publishSite: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const admin = createAdminClient();
    // Month-plan placeholders ('planned') have empty bodies — never bulk-publish them.
    const { data: drafts } = await admin.from('brand_articles').select('id').eq('brand_id', brand.id).neq('status', 'published').neq('status', 'planned');
    const ids = (drafts ?? []).map((d) => d.id);
    const { error } = await admin.from('brand_articles')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('brand_id', brand.id).neq('status', 'published').neq('status', 'planned');
    if (error) return fail(500, { error: error.message });
    const { markPlacementsPublished } = await import('$lib/server/backlink-network');
    for (const id of ids) await markPlacementsPublished(admin, id).catch(swallow('mark placements published'));
    const { syncArticlesToCMS } = await import('$lib/server/cms-sync');
    const cms = await syncArticlesToCMS(admin, brand.id, ids);
    return { sitePublished: true, cms };
  },

  setStatus: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const publish = String(fd.get('publish') ?? '') === 'true';
    if (!id) return fail(400, { error: 'Missing id' });
    const admin = createAdminClient();
    const { error } = await admin.from('brand_articles')
      .update({ status: publish ? 'published' : 'draft', published_at: publish ? new Date().toISOString() : null })
      .eq('id', id).eq('brand_id', brand.id).neq('status', 'planned'); // placeholders have no content to publish
    if (error) return fail(500, { error: error.message });
    // On publish, also push to connected CMS (Shopify/Webflow); hosted is implicit via status.
    let cms = null;
    if (publish) {
      const { markPlacementsPublished } = await import('$lib/server/backlink-network');
      await markPlacementsPublished(admin, id).catch(swallow('mark placements published'));
      const { syncArticlesToCMS } = await import('$lib/server/cms-sync');
      cms = await syncArticlesToCMS(admin, brand.id, [id]);
    }
    return { statusSet: true, cms };
  },

  // Schedule (or clear) an article's future publish time. The blog publish cron flips it to
  // 'published' when the instant passes. Empty `when` clears the schedule back to a plain draft.
  scheduleArticle: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const when = String(fd.get('when') ?? '').trim(); // "YYYY-MM-DDTHH:mm" (brand wall-clock) or ''
    if (!id) return fail(400, { error: 'Missing id' });
    const admin = createAdminClient();
    const { data: art } = await admin.from('brand_articles').select('status').eq('id', id).eq('brand_id', brand.id).maybeSingle();
    if (!art) return fail(404, { error: 'Article not found' });
    let patch: Record<string, unknown>;
    if (!when) {
      // A month-plan placeholder without a date would never get written — clearing it means deleting it.
      if (art.status === 'planned') return fail(400, { error: 'invalid_datetime' });
      patch = { scheduled_for: null, status: 'draft' };
    } else {
      const m = when.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (!m) return fail(400, { error: 'invalid_datetime' });
      const iso = wallClockToUtc(m[1], m[2], brand.timezone);
      if (new Date(iso).getTime() <= Date.now()) return fail(400, { error: 'past_datetime' });
      // Placeholders only move their slot — 'approved' (auto-publish) is reserved for real drafts.
      patch = art.status === 'planned' ? { scheduled_for: iso } : { scheduled_for: iso, status: 'approved' };
    }
    const { error } = await admin.from('brand_articles').update(patch).eq('id', id).eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { scheduled: !!when };
  },

  // Spread every unscheduled draft over the coming days at the blog's articlesPerWeek cadence,
  // skipping days that already have a scheduled article. 10:00 brand time, like the autopilot drip.
  scheduleAllDrafts: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const admin = createAdminClient();
    const [{ data: drafts }, { data: brandRow }, { data: scheduled }] = await Promise.all([
      admin.from('brand_articles').select('id').eq('brand_id', brand.id).neq('status', 'published').is('scheduled_for', null).order('created_at', { ascending: true }),
      admin.from('brands').select('blog_config, plan').eq('id', brand.id).maybeSingle(),
      admin.from('brand_articles').select('scheduled_for').eq('brand_id', brand.id).not('scheduled_for', 'is', null).gte('scheduled_for', new Date().toISOString())
    ]);
    if (!drafts?.length) return { scheduledAll: 0 };
    const cfg = (brandRow?.blog_config ?? {}) as { articlesPerWeek?: unknown };
    const weekMax = blogArticlesPerWeekMax(brandRow?.plan);
    const perWeek =
      cfg.articlesPerWeek == null
        ? blogArticlesPerWeek(brandRow?.plan)
        : Math.min(weekMax, Number(cfg.articlesPerWeek) || 0) || 1;
    const stepDays = Math.max(1, Math.round(7 / perWeek));
    const dayInTz = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: brand.timezone }).format(d);
    const taken = new Set((scheduled ?? []).map((a) => dayInTz(new Date(a.scheduled_for as string))));
    let cursor = new Date();
    for (const d of drafts) {
      // next free day, starting tomorrow, then keep the cadence between posts
      do { cursor = new Date(cursor.getTime() + 86400000); } while (taken.has(dayInTz(cursor)));
      const day = dayInTz(cursor);
      taken.add(day);
      const { error } = await admin.from('brand_articles')
        .update({ scheduled_for: wallClockToUtc(day, '10:00', brand.timezone), status: 'approved' })
        .eq('id', d.id).eq('brand_id', brand.id);
      if (error) return fail(500, { error: error.message });
      cursor = new Date(cursor.getTime() + (stepDays - 1) * 86400000);
    }
    return { scheduledAll: drafts.length };
  },

  deleteArticle: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const { error } = await createAdminClient().from('brand_articles').delete().eq('id', id).eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { deleted: true };
  },

  publishSelected: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const ids = String((await request.formData()).get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return fail(400, { error: 'No articles selected' });
    const admin = createAdminClient();
    const { data: arts } = await admin
      .from('brand_articles')
      .select('id')
      .eq('brand_id', brand.id)
      .in('id', ids)
      .neq('status', 'published')
      .neq('status', 'planned');
    const publishIds = (arts ?? []).map((a) => a.id);
    if (!publishIds.length) return { publishedSelected: 0 };
    const { error } = await admin
      .from('brand_articles')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('brand_id', brand.id)
      .in('id', publishIds);
    if (error) return fail(500, { error: error.message });
    const { syncArticlesToCMS } = await import('$lib/server/cms-sync');
    const cms = await syncArticlesToCMS(admin, brand.id, publishIds);
    return { publishedSelected: publishIds.length, cms };
  },

  deleteSelected: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const ids = String((await request.formData()).get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return fail(400, { error: 'No articles selected' });
    const { error } = await createAdminClient()
      .from('brand_articles')
      .delete()
      .eq('brand_id', brand.id)
      .in('id', ids);
    if (error) return fail(500, { error: error.message });
    return { deletedSelectedArticles: ids.length };
  },

  // Enable/disable the blog for this brand: gates whether the plan & radar include blog articles.
  // Save blog UI customization (title, accent colour, font, layout, navbar links).
  // Upload the blog icon (used as header mark + favicon). Public URL in the media bucket.
  // Upload a cover/thumbnail for one article (also used as og:image). Public URL, media bucket.
  uploadCover: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const file = fd.get('cover');
    if (!id) return fail(400, { error: 'Missing id' });
    if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'no_file' });
    const img = await readUploadImage(file, { maxOutBytes: 5_000_000 });
    if (!img.ok) return fail(400, { error: img.error === 'too_large' ? 'too_large' : 'not_image' });
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'unauthorized' });
    const ext = img.mime.includes('png') ? 'png' : 'jpg';
    const path = `${user.id}/blog/cover-${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('media').upload(path, img.bytes, { contentType: img.mime, upsert: false });
    if (up.error) return fail(400, { error: up.error.message });
    const url = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
    const { error } = await createAdminClient().from('brand_articles').update({ cover_image: url }).eq('id', id).eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { coverUploaded: true };
  },

  // Generate the cover/thumbnail with AI (on-brand 16:9 hero), set it on the article.
  generateCover: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const admin = createAdminClient();
    const { data: art } = await admin.from('brand_articles').select('title, meta_description').eq('id', id).eq('brand_id', brand.id).maybeSingle();
    if (!art) return fail(404, { error: 'Article not found' });
    const { generateArticleCover } = await import('$lib/server/content-preview');
    const url = await generateArticleCover(admin, brand, { title: art.title, summary: art.meta_description ?? undefined });
    if (!url) return fail(502, { error: 'cover_gen_failed' });
    const { error } = await admin.from('brand_articles').update({ cover_image: url }).eq('id', id).eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { coverGenerated: true };
  },

  // Generate a few on-brand images and splice them into the article body (in-article illustrations).
  generateArticleImages: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const admin = createAdminClient();
    const { data: art } = await admin.from('brand_articles').select('title, body_md').eq('id', id).eq('brand_id', brand.id).maybeSingle();
    if (!art) return fail(404, { error: 'Article not found' });
    const { generateArticleImages } = await import('$lib/server/content-preview');
    // replaceExisting: regenerate with product-faithful shots even when sections already have images.
    const newBody = await generateArticleImages(admin, brand, {
      title: art.title, bodyMd: art.body_md ?? '', max: 3, replaceExisting: true
    });
    if (newBody === (art.body_md ?? '')) return fail(502, { error: 'images_failed' });
    const { error } = await admin.from('brand_articles').update({ body_md: newBody, updated_at: new Date().toISOString() }).eq('id', id).eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { articleImages: true };
  },

  // Second AI pass on an existing article: raise its quality score toward >90 (all checks green).
  optimizeArticle: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const { optimizeArticleForScore } = await import('$lib/server/blog-generate');
    await optimizeArticleForScore(createAdminClient(), brand, id, { withImages: true }).catch(swallow('createAdminClient failed'));
    return { articleOptimized: true };
  },

  removeCover: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const { error } = await createAdminClient().from('brand_articles').update({ cover_image: null }).eq('id', id).eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { coverRemoved: true };
  },

  humanizeArticle: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const admin = createAdminClient();
    const { data: art } = await admin.from('brand_articles').select('title, body_md, language').eq('id', id).eq('brand_id', brand.id).maybeSingle();
    if (!art?.body_md) return fail(404, { error: 'Article not found' });
    const { humanizeArticle } = await import('$lib/server/blog-humanizer');
    const result = await humanizeArticle(admin, brand.id, art.body_md, art.title, (art as any).language || 'Italian');
    if (!result) return fail(502, { error: 'humanize_failed' });
    const { error } = await admin.from('brand_articles').update({ body_md: result.bodyMd, updated_at: new Date().toISOString() }).eq('id', id).eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { humanized: true, changes: result.changes };
  },

  toggleBlog
};
