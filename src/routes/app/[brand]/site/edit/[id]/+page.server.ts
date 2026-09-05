import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { readUploadImage } from '$lib/server/raster-image';
import { updateBrandRow } from '$lib/server/brand-rows';

// AI cover generation runs the image model → give it headroom.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

async function brandBySlug(supabase: App.Locals['supabase'], slug: string) {
  const { data } = await supabase.from('brands').select('id, name').eq('slug', slug).maybeSingle();
  return data;
}

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');
  const { data: a } = await supabase
    .from('brand_articles')
    .select('id, slug, title, meta_title, meta_description, body_md, cover_image, status, version_seq, category_id, author_id')
    .eq('id', params.id).maybeSingle();
  if (!a) throw error(404, 'Article not found');
  const { data: brand } = await supabase.from('brands').select('website').eq('slug', params.brand).maybeSingle();
  const { scoreArticle } = await import('$lib/server/article-score');
  const score = scoreArticle({ bodyMd: a.body_md ?? '', metaTitle: a.meta_title, metaDescription: a.meta_description, status: a.status }, brand?.website);

  // Load categories, tags, authors, and this article's tags
  const admin = (await import('$lib/server/supabase-admin')).createAdminClient();
  const [catsRes, tagsRes, authorsRes, artTagsRes] = await Promise.all([
    admin.from('blog_categories').select('id, name, slug').eq('brand_id', brand?.id ?? '').order('sort_order', { ascending: true }),
    admin.from('blog_tags').select('id, name, slug').eq('brand_id', brand?.id ?? '').order('name', { ascending: true }),
    admin.from('blog_authors').select('id, name, slug').eq('brand_id', brand?.id ?? '').order('name', { ascending: true }),
    admin.from('brand_article_tags').select('tag_id').eq('article_id', params.id)
  ]);

  return {
    article: {
      id: a.id, slug: a.slug, title: a.title, metaTitle: a.meta_title ?? '',
      metaDescription: a.meta_description ?? '', bodyMd: a.body_md ?? '', cover: a.cover_image ?? null, status: a.status,
      categoryId: a.category_id ?? null, authorId: a.author_id ?? null
    },
    score,
    categories: (catsRes.data ?? []).map((c: any) => ({ id: c.id, name: c.name, slug: c.slug })),
    allTags: (tagsRes.data ?? []).map((t: any) => ({ id: t.id, name: t.name, slug: t.slug })),
    authors: (authorsRes.data ?? []).map((a: any) => ({ id: a.id, name: a.name, slug: a.slug })),
    articleTagIds: (artTagsRes.data ?? []).map((t: any) => t.tag_id)
  };
};

export const actions: Actions = {
  save: async ({ request, params, locals: { supabase } }) => {
    const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const title = String(fd.get('title') ?? '').trim().slice(0, 200);
    const bodyMd = String(fd.get('body_md') ?? '');
    const metaTitle = String(fd.get('meta_title') ?? '').trim().slice(0, 70);
    const metaDescription = String(fd.get('meta_description') ?? '').trim().slice(0, 200);
    const categoryId = String(fd.get('category_id') ?? '').trim() || null;
    const authorId = String(fd.get('author_id') ?? '').trim() || null;
    const tagIds = fd.getAll('tag_ids').map((t) => String(t)).filter(Boolean);
    if (!title) return fail(400, { error: 'title_required' });
    const admin = createAdminClient();
    const failure = await updateBrandRow(admin, 'brand_articles', brand.id, params.id, {
      title, body_md: bodyMd, meta_title: metaTitle || null, meta_description: metaDescription || null,
      category_id: categoryId, author_id: authorId,
      updated_at: new Date().toISOString()
    });
    if (failure) return fail(failure.status, { error: failure.error });
    await admin.from('brand_article_tags').delete().eq('article_id', params.id);
    if (tagIds.length) {
      await admin.from('brand_article_tags').insert(tagIds.map((tid) => ({ article_id: params.id, tag_id: tid })));
    }
    return { saved: true };
  },

  // Upload a cover/thumbnail from the device (also used as og:image).
  uploadCover: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const file = (await request.formData()).get('cover');
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
    const { error: e } = await createAdminClient().from('brand_articles').update({ cover_image: url }).eq('id', params.id).eq('brand_id', brand.id);
    if (e) return fail(500, { error: e.message });
    return { coverUploaded: true };
  },

  // Generate the cover with AI — same brand aesthetic context as the post image pipeline.
  generateCover: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const admin = createAdminClient();
    const { data: art } = await admin.from('brand_articles').select('title, meta_description').eq('id', params.id).eq('brand_id', brand.id).maybeSingle();
    if (!art) return fail(404, { error: 'Article not found' });
    const { generateArticleCover } = await import('$lib/server/content-preview');
    const url = await generateArticleCover(admin, brand, { title: art.title, summary: art.meta_description ?? undefined });
    if (!url) return fail(502, { error: 'cover_gen_failed' });
    const { error: e } = await admin.from('brand_articles').update({ cover_image: url }).eq('id', params.id).eq('brand_id', brand.id);
    if (e) return fail(500, { error: e.message });
    return { coverGenerated: true };
  },

  removeCover: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const { error: e } = await createAdminClient().from('brand_articles').update({ cover_image: null }).eq('id', params.id).eq('brand_id', brand.id);
    if (e) return fail(500, { error: e.message });
    return { coverRemoved: true };
  }
};
