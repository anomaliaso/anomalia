import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { LIST_WEB_FIXES } from '@anomalia/api-contracts';
import { listWebFixes } from '$lib/server/web-evidence';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = LIST_WEB_FIXES.input.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }
  const { fix_id: fixId, status, limit, offset } = parsed.data;

  return json(await listWebFixes(supabase, brand.id, { fixId, status, limit, offset }));
};
