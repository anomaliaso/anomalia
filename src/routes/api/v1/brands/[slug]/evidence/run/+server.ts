import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { GET_EVIDENCE_RUN } from '@anomalia/api-contracts';
import { getEvidenceRun } from '$lib/server/seo-geo-evidence';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = GET_EVIDENCE_RUN.input.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }
  const { run_id: runId, limit, offset } = parsed.data;

  return json(await getEvidenceRun(supabase, brand.id, { runId, limit, offset }));
};
