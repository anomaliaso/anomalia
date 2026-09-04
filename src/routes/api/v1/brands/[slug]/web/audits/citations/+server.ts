import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { LIST_AUDIT_CITATIONS } from '@anomalia/api-contracts';
import { listAuditCitations } from '$lib/server/web-evidence';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = LIST_AUDIT_CITATIONS.input.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }
  const { audit_id: auditId, limit, offset } = parsed.data;

  return json(await listAuditCitations(supabase, brand.id, { auditId, limit, offset }));
};
