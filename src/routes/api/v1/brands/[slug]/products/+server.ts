import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

// GET: list all products (title, category/kind, price, image count, featured).
export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const { data: products } = await supabase
    .from('products')
    .select('id, title, kind, pricing, images, featured')
    .eq('brand_id', brand.id)
    .order('created_at', { ascending: true });

  return json({
    products: (products ?? []).map((p: any) => ({
      id: p.id,
      title: p.title,
      kind: p.kind ?? 'product',
      pricing: p.pricing ?? null,
      imageCount: Array.isArray(p.images) ? p.images.length : 0,
      featured: p.featured ?? false
    }))
  });
};

// POST: re-sync the full catalog from the brand's e-commerce site (Shopify / WooCommerce).
// Mirrors the chat `sync_products` action, including the Shopify product_type → kind mapping.
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const { data: brandRow } = await supabase.from('brands').select('website').eq('id', brand.id).maybeSingle();
  if (!brandRow?.website) return json({ error: 'No website URL set for this brand.' }, { status: 400 });

  try {
    const { isShopifySite, fetchShopifyProducts, isWooCommerceSite, fetchWooCommerceProducts } = await import('$lib/server/brand-analysis');
    const res = await fetch(brandRow.website);
    const html = await res.text();

    let products: any[] = [];
    let platform = '';
    if (isShopifySite(html)) { products = await fetchShopifyProducts(brandRow.website); platform = 'Shopify'; }
    else if (isWooCommerceSite(html)) { products = await fetchWooCommerceProducts(brandRow.website); platform = 'WooCommerce'; }
    else return json({ error: 'No e-commerce platform detected on the site.' }, { status: 400 });

    if (!products.length) return json({ error: 'No products found on the site.' }, { status: 400 });

    await supabase.from('products').delete().eq('brand_id', brand.id);
    await supabase.from('products').insert(
      products.map((p: any) => ({
        brand_id: brand.id,
        title: p.name,
        description: p.description ?? '',
        pricing: p.pricing ?? null,
        kind: p.productType ?? 'product',
        images: p.images ?? null
      }))
    );

    return json({ ok: true, platform, synced: products.length });
  } catch (e) {
    return json({ error: `Sync failed: ${String(e)}` }, { status: 500 });
  }
};
