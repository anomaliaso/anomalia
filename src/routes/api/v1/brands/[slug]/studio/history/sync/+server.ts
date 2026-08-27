import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  try {
    const { syncBrandPostHistoryFromSocials } = await import('$lib/server/scrapecreators');
    const result = await syncBrandPostHistoryFromSocials(supabase, brand);

    // Rebuild brand context if posts were synced
    if (result.synced > 0) {
      try {
        const { rebuildBrandContext } = await import('$lib/server/brand-context');
        await rebuildBrandContext(supabase, brand.id);
      } catch (error) { swallow('rebuild brand context', error); }
    }

    return json(result);
  } catch (e) {
    return json({ error: `Sync failed: ${String(e)}` }, { status: 500 });
  }
};
