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
    const { activatePlan } = await import('$lib/server/editorial-plan');

    const { data: proposed } = await supabase
      .from('editorial_plans').select('id')
      .eq('brand_id', brand.id).eq('status', 'proposed')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!proposed) return json({ error: 'No proposed plan to approve' }, { status: 404 });

    await activatePlan(supabase, brand.id, proposed.id, brand.timezone as string);

    return json({ ok: true });
  } catch (e) {
    return json({ error: `Approve failed: ${String(e)}` }, { status: 500 });
  }
};
