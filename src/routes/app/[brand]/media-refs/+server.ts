import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import { signKnowledgePaths } from '$lib/server/media-archive';
import { likenessConsented } from '$lib/server/design-visual-refs';
import { signPersonImages, type PersonImage } from '$lib/server/people';
import { createAdminClient } from '$lib/server/supabase-admin';
import { listTalents } from '$lib/server/talent';
import { listStoredAdRefs } from '$lib/server/stored-ads';
import type { RequestHandler } from './$types';

// Lists reusable reference images for post editor + brand chat composer + media generator:
//  - brandImages: Studio mood refs (brand_documents kind='image') + Media library images
//  - postThumbs:  recent own-post thumbnails (social_post_history)
//  - people:      brand people from Studio whose likeness may be used (see likenessConsented)
//  - talents:     global AI talents from /talents (all signed views)
//  - products:    brand catalog products with image URLs
//  - ads:         already-harvested Meta Ad Library creatives (no live pull)
// URLs are for DISPLAY only; clients send back row IDs / talent ids for server-side re-resolve
// (chat) or signed/CDN URLs as referenceUrls (media generator).
// For arbitrary other-account posts, clients use POST /social-thumbs (ScrapeCreators).
export const GET: RequestHandler = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ brandImages: [], postThumbs: [], people: [], talents: [], products: [], ads: [] });

  const admin = createAdminClient();

  const [{ data: imgDocs }, { data: libraryMedia }, { data: hist }, { data: peopleRows }, { data: productRows }, talentRows, ads] =
    await Promise.all([
    supabase
      .from('brand_documents')
      .select('id, file_url')
      .eq('brand_id', brand.id)
      .eq('kind', 'image')
      .order('created_at', { ascending: false })
      .limit(24),
    supabase
      .from('brand_media')
      .select('id, storage_path, title, kind')
      .eq('brand_id', brand.id)
      .eq('kind', 'image')
      .order('created_at', { ascending: false })
      .limit(48),
    supabase
      .from('social_post_history')
      .select('id, thumbnail_path, thumbnail_url')
      .eq('brand_id', brand.id)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(36),
    supabase
      .from('people')
      .select('id, name, role, kind, consent, images')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: true })
      .limit(24),
    supabase
      .from('products')
      .select('id, title, images')
      .eq('brand_id', brand.id)
      .order('featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(48),
    listTalents(admin).catch((error) => { swallow('list talents', error); return []; }),
    listStoredAdRefs(supabase, brand.id).catch((error) => { swallow('list stored ad refs', error); return []; })
  ]);

  const paths = [
    ...(imgDocs ?? []).map((d) => String(d.file_url ?? '')),
    ...(libraryMedia ?? []).map((m) => String(m.storage_path ?? '')),
    ...(hist ?? []).map((h) => String(h.thumbnail_path ?? ''))
  ].filter(Boolean);
  const signed = await signKnowledgePaths(supabase, paths).catch((error) => { swallow('sign media urls', error); return new Map<string, string>(); });

  const brandImages = [
    ...(imgDocs ?? []).map((d) => ({
      id: d.id as string,
      url: signed.get(String(d.file_url ?? '')) ?? null,
      source: 'mood' as const,
      title: null as string | null
    })),
    ...(libraryMedia ?? []).map((m) => ({
      id: m.id as string,
      url: signed.get(String(m.storage_path ?? '')) ?? null,
      source: 'library' as const,
      title: (m.title as string | null) ?? null
    }))
  ].filter((x): x is { id: string; url: string; source: 'mood' | 'library'; title: string | null } => !!x.url);

  const postThumbs = (hist ?? [])
    .map((h) => ({
      id: h.id,
      url: signed.get(String(h.thumbnail_path ?? '')) ?? (h.thumbnail_url ? String(h.thumbnail_url) : null)
    }))
    .filter((x): x is { id: string; url: string } => !!x.url);

  const people: Array<{ id: string; name: string; role: string | null; url: string; urls: string[] }> = [];
  for (const row of peopleRows ?? []) {
    if (!likenessConsented(row)) {
      continue;
    }
    const urls = await signPersonImages(supabase, (row.images ?? []) as PersonImage[]);
    if (!urls.length) continue;
    people.push({
      id: row.id,
      name: row.name,
      role: row.role ?? null,
      url: urls[0],
      urls
    });
  }

  const talents = talentRows
    .map((t) => {
      const urls = t.views.map((v) => v.url).filter((u): u is string => !!u);
      if (!urls.length) return null;
      return {
        id: t.id,
        slug: t.slug,
        name: t.name,
        url: urls[0],
        urls
      };
    })
    .filter((x): x is { id: string; slug: string; name: string; url: string; urls: string[] } => !!x);

  // Product catalog images are usually absolute CDN URLs (Shopify/Woo/etc.).
  const products = (productRows ?? [])
    .map((p) => {
      const urls = (Array.isArray(p.images) ? p.images : [])
        .map((u) => String(u ?? '').trim())
        .filter((u) => /^https?:\/\//i.test(u) || u.startsWith('data:'));
      if (!urls.length) return null;
      return {
        id: p.id as string,
        name: String(p.title ?? 'Product'),
        url: urls[0],
        urls
      };
    })
    .filter((x): x is { id: string; name: string; url: string; urls: string[] } => !!x);

  return json({ brandImages, postThumbs, people, talents, products, ads });
};
