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

  const body = await request.json();
  const { name, website, kind, rationale } = body;

  if (!name) return json({ error: 'name is required' }, { status: 400 });

  // Normalize website
  let normalizedWebsite = website ?? null;
  if (normalizedWebsite && !normalizedWebsite.startsWith('http')) {
    normalizedWebsite = `https://${normalizedWebsite}`;
  }

  const { data, error: insertError } = await supabase
    .from('competitors')
    .insert({
      brand_id: brand.id,
      name,
      website: normalizedWebsite,
      kind: kind ?? 'direct',
      rationale: rationale ?? null,
      source: 'user',
    })
    .select('id, name, website, kind, source')
    .single();

  if (insertError) return json({ error: insertError.message }, { status: 500 });
  return json({ ok: true, competitor: data });
};
