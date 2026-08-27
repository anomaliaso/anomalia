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

  const { error: updateError } = await supabase
    .from('editorial_plans')
    .update({ status: 'rejected' })
    .eq('brand_id', brand.id).eq('status', 'proposed');

  if (updateError) return json({ error: updateError.message }, { status: 500 });
  return json({ ok: true });
};
