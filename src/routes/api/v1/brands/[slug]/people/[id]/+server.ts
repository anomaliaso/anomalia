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
  const { name, role, description, attributes } = body;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (role !== undefined) updates.role = role;
  if (description !== undefined) updates.description = description;
  if (attributes !== undefined) updates.attributes = attributes;

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('people').update(updates)
    .eq('id', params.id).eq('brand_id', brand.id);

  if (updateError) return json({ error: updateError.message }, { status: 500 });
  return json({ ok: true });
};
