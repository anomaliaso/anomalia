// Push published articles to every connected external CMS (Shopify + Webflow + Wix) for a brand.
// Each platform sync is best-effort and a no-op when that platform isn't connected/active, so this
// is safe to call on every publish. Returns the combined pushed/failed counts.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncArticlesToShopify } from './shopify';
import { syncArticlesToWebflow } from './webflow';
import { syncArticlesToWix } from './wix';

export async function syncArticlesToCMS(admin: SupabaseClient, brandId: string, articleIds: string[]): Promise<{ pushed: number; failed: number }> {
  const zero = { pushed: 0, failed: 0 };
  const [shopify, webflow, wix] = await Promise.all([
    syncArticlesToShopify(admin, brandId, articleIds).catch((error) => { swallow('syncArticlesToShopify failed', error); return zero; }),
    syncArticlesToWebflow(admin, brandId, articleIds).catch((error) => { swallow('syncArticlesToWebflow failed', error); return zero; }),
    syncArticlesToWix(admin, brandId, articleIds).catch((error) => { swallow('syncArticlesToWix failed', error); return zero; })
  ]);
  return { pushed: shopify.pushed + webflow.pushed + wix.pushed, failed: shopify.failed + webflow.failed + wix.failed };
}
