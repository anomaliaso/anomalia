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

  const { draft_id, seeds } = await request.json();
  if (!draft_id) return json({ error: 'draft_id is required' }, { status: 400 });

  const { error: updateError } = await supabase
    .from('content_plans')
    .update({ seeds })
    .eq('id', draft_id).eq('brand_id', brand.id);

  if (updateError) return json({ error: updateError.message }, { status: 500 });
  return json({ ok: true });
};
