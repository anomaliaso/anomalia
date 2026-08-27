import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json();
  const { name, website, kind, rationale } = body;

  let normalizedWebsite = website ?? null;
  if (normalizedWebsite && !normalizedWebsite.startsWith('http')) {
    normalizedWebsite = `https://${normalizedWebsite}`;
  }

  const { error: updateError } = await supabase
    .from('competitors')
    .update({
      ...(name !== undefined && { name }),
      ...(website !== undefined && { website: normalizedWebsite }),
      ...(kind !== undefined && { kind }),
      ...(rationale !== undefined && { rationale }),
    })
    .eq('id', params.id)
    .eq('brand_id', brand.id);

  if (updateError) return json({ error: updateError.message }, { status: 500 });
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const { error: deleteError } = await supabase
    .from('competitors').delete().eq('id', params.id).eq('brand_id', brand.id);

  if (deleteError) return json({ error: deleteError.message }, { status: 500 });
  return json({ ok: true });
};
