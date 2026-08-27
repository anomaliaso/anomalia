// Product catalog helpers for AI prompts (blog writer, chat, revise). Surfaces real product page
// URLs + image URLs so models can link without inventing them — same contract as getBrandPages.
import type { SupabaseClient } from '@supabase/supabase-js';

export type BrandProductLink = {
  id: string;
  title: string;
  description: string | null;
  pricing: string | null;
  kind: string | null;
  featured: boolean | null;
  url: string | null;
  /** First product image URL when available (Shopify/Woo CDN). */
  imageUrl: string | null;
};

function firstImageUrl(images: unknown): string | null {
  if (!Array.isArray(images) || !images.length) return null;
  const first = images[0];
  if (typeof first === 'string' && /^https?:\/\//i.test(first)) return first;
  if (first && typeof first === 'object' && typeof (first as { src?: string }).src === 'string') {
    const src = (first as { src: string }).src;
    return /^https?:\/\//i.test(src) ? src : null;
  }
  return null;
}

/** Featured first, then products that have a real URL — capped for prompt size. */
export async function getBrandProductsForAi(
  admin: SupabaseClient,
  brandId: string,
  limit = 30
): Promise<BrandProductLink[]> {
  const { data } = await admin
    .from('products')
    .select('id, title, description, pricing, kind, featured, url, images')
    .eq('brand_id', brandId)
    .order('featured', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(Math.max(limit * 2, limit));
  const rows = (data ?? []).map((p) => ({
    id: p.id as string,
    title: String(p.title ?? ''),
    description: (p.description as string | null) ?? null,
    pricing: (p.pricing as string | null) ?? null,
    kind: (p.kind as string | null) ?? null,
    featured: (p.featured as boolean | null) ?? null,
    url: typeof p.url === 'string' && /^https?:\/\//i.test(p.url) ? p.url : null,
    imageUrl: firstImageUrl(p.images)
  }));
  // Prefer linkable products; keep a few without URLs so the model still knows what exists.
  const withUrl = rows.filter((r) => r.url);
  const without = rows.filter((r) => !r.url);
  return [...withUrl, ...without].slice(0, limit);
}

/** One-line-per-product block for system / blog prompts. Exact URLs only. */
export function formatProductsList(products: BrandProductLink[]): string {
  if (!products.length) return '(no products in catalog — do not invent product links)';
  return products
    .map((p) => {
      const bits = [
        p.title || 'Untitled',
        p.url ? `→ ${p.url}` : '(no page URL)',
        p.pricing ? `price=${p.pricing}` : null,
        p.kind ? `kind=${p.kind}` : null,
        p.featured ? '★ featured' : null,
        p.imageUrl ? `img=${p.imageUrl}` : null,
        p.description ? `— ${p.description.replace(/\s+/g, ' ').trim().slice(0, 120)}` : null
      ].filter(Boolean);
      return `- ${bits.join(' | ')}`;
    })
    .join('\n');
}
