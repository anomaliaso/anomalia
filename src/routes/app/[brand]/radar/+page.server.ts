import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { radarPrefsOf } from '$lib/server/radar';
import { editorActions } from '$lib/server/post-editing';
import { hasProRadarLeads } from '$lib/server/plans';
import { cachedBrandPage } from '$lib/server/page-cache';

// The "→ Blog" action generates a full article (grounded AI) → give it headroom.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

// Radar — dedicated page under the Social nav group. Digest/breaking settings and recent
// scanned items. Sources (default platforms + custom feeds) live in Settings → Radar.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandBySlug(supabase: any, slug: string) {
  const { data } = await supabase.from('brands').select('id, content_prefs, plan').eq('slug', slug).maybeSingle();
  return data;
}

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const [{ data: items }, { data: brandRow }, { data: radarPosts }, { data: searches }, { count: sourceCount }] =
      await Promise.all([
        supabase
          .from('brand_news_items')
          .select(
            'title, url, source_name, status, relevance, urgency, angle, skip_reason, suggestion, dm_draft, dm_target, created_at'
          )
          .eq('brand_id', brand.id)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.from('brands').select('content_prefs').eq('id', brand.id).maybeSingle(),
        // The instant posts Radar created (source='radar'), newest first, with their news citation.
        supabase
          .from('posts')
          .select('id, caption, media_url, status, source_url, needs_attention, attention_reason, created_at')
          .eq('brand_id', brand.id)
          .eq('source', 'radar')
          .order('created_at', { ascending: false })
          .limit(12),
        // Search history: what each scan looked at and yielded (RLS-scoped to the user's brands).
        supabase
          .from('radar_searches')
          .select(
            'created_at, mode, sources, items_found, items_fresh, items_relevant, posts_proposed, comments_proposed, articles_proposed, ms'
          )
          .eq('brand_id', brand.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('brand_news_sources')
          .select('id', { count: 'exact', head: true })
          .eq('brand_id', brand.id)
      ]);

    return {
      radarItems: items ?? [],
      radar: radarPrefsOf(brandRow?.content_prefs),
      radarPosts: radarPosts ?? [],
      radarSearches: searches ?? [],
      sourceCount: sourceCount ?? 0,
      hasProRadarLeads: hasProRadarLeads(brand.plan)
    };
  });
};

export const actions: Actions = {
  radarSettings: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = ((brand.content_prefs as any) ?? {}) as Record<string, unknown>;
    const prevRadar = (prefs.radar as Record<string, unknown>) ?? {};
    const radar = {
      ...prevRadar,
      enabled: String(fd.get('enabled') ?? '') === 'on',
      mode: String(fd.get('mode') ?? 'digest') === 'breaking' ? 'breaking' : 'digest',
      maxPerDay: Math.max(1, Math.min(3, Number(fd.get('maxPerDay')) || 1)),
      replyTone: String(fd.get('replyTone') || 'friendly'),
      replyStyle: String(fd.get('replyStyle') || '').trim(),
      leadInstructions: String(fd.get('leadInstructions') || '')
        .trim()
        .slice(0, 2000),
      emailPerRun: String(fd.get('emailPerRun') ?? '') === 'on'
    };
    const { error } = await supabase.from('brands').update({ content_prefs: { ...prefs, radar } }).eq('id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { saved: true };
  },

  // Reactive "second loading" for the blog: turn a radar news item into a full blog-article draft.
  generateBlogFromItem: async ({ request, params, locals: { supabase } }) => {
    const { data: brand } = await supabase.from('brands').select('id, name').eq('slug', params.brand).maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const title = String(fd.get('title') ?? '').trim();
    if (!title) return fail(400, { error: 'Missing title' });
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { generateBlogFromNews } = await import('$lib/server/blog-generate');
    const id = await generateBlogFromNews(createAdminClient(), brand, {
      title,
      url: String(fd.get('url') ?? '') || undefined,
      context: String(fd.get('context') ?? '') || undefined
    });
    if (!id) return fail(502, { error: 'blog_gen_failed' });
    return { blogGenerated: true };
  },

  // Approve / reject an instant Radar post inline — same shared path as the Content queue and the
  // one-click email link (approve → publishApprovedPost, reject → delete).
  approve: editorActions.approve,
  reject: editorActions.reject
};
