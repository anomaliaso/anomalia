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
  const { title, description, pricing, featured } = body;

  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (pricing !== undefined) updates.pricing = pricing;
  if (featured !== undefined) updates.featured = featured;

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('products').update(updates)
    .eq('id', params.id).eq('brand_id', brand.id);

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
    .from('products').delete().eq('id', params.id).eq('brand_id', brand.id);

  if (deleteError) return json({ error: deleteError.message }, { status: 500 });
  return json({ ok: true });
};
