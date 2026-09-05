import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { GET_AUDIT_FINDINGS } from '@anomalia/api-contracts';
import { getAuditFindings } from '$lib/server/web-evidence';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = GET_AUDIT_FINDINGS.input.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  return json(await getAuditFindings(supabase, brand.id, parsed.data.audit_id));
};
