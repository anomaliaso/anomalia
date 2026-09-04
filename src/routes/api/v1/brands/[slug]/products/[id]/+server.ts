import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { updateBrandRow, deleteBrandRow } from '$lib/server/brand-rows';
import { UPDATE_PRODUCT } from '@anomalia/api-contracts';

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json().catch(() => ({}));
  const parsed = UPDATE_PRODUCT.input.safeParse({ ...body, id: params.id });
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { id, ...patch } = parsed.data;
  const failure = await updateBrandRow(supabase, 'products', brand.id, id, patch);
  if (failure) return json({ error: failure.error }, { status: failure.status });

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const failure = await deleteBrandRow(supabase, 'products', brand.id, params.id);
  if (failure) return json({ error: failure.error }, { status: failure.status });

  return json({ ok: true });
};
