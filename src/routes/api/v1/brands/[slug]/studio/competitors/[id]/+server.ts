import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { updateBrandRow, deleteBrandRow } from '$lib/server/brand-rows';
import { normalizeWebsite } from '$lib/brand-fields';
import { UPDATE_COMPETITOR } from '@anomalia/api-contracts';

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json().catch(() => ({}));
  const parsed = UPDATE_COMPETITOR.input.safeParse({ ...body, id: params.id });
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { id, ...fields } = parsed.data;
  const patch = {
    ...fields,
    ...(fields.website !== undefined && { website: normalizeWebsite(fields.website) })
  };

  const failure = await updateBrandRow(supabase, 'competitors', brand.id, id, patch);
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

  const failure = await deleteBrandRow(supabase, 'competitors', brand.id, params.id);
  if (failure) return json({ error: failure.error }, { status: failure.status });

  return json({ ok: true });
};
