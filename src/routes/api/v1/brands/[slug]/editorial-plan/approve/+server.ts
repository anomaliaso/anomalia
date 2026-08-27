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
    const { loadActivePlan, activatePlan, syncPrefsFromPlan } = await import('$lib/server/editorial-plan');

    // Find the proposed plan
    const { data: proposed } = await supabase
      .from('editorial_plans').select('*')
      .eq('brand_id', brand.id).eq('status', 'proposed')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!proposed) return json({ error: 'No proposed plan to approve' }, { status: 404 });

    // Load current active plan (if any) to get the old ID
    const oldActive = await loadActivePlan(supabase, brand.id);

    // Activate the proposed plan
    await activatePlan(supabase, brand.id, proposed.id, brand.timezone as string);

    // Supersede old plan
    if (oldActive) {
      await supabase.from('editorial_plans')
        .update({ status: 'superseded' })
        .eq('id', oldActive.id);
    }

    // Sync prefs
    await syncPrefsFromPlan(supabase, brand.id, proposed);

    return json({ ok: true });
  } catch (e) {
    return json({ error: `Approve failed: ${String(e)}` }, { status: 500 });
  }
};
