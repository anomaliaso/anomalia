import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { loadApprovedRubrics, loadProposedRubrics } from '$lib/server/rubrics';

// The brand's rubric state: the APPROVED set currently driving the planners, plus the latest
// PROPOSED batch awaiting the client's review (empty when none pending).
export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const [approved, proposed] = await Promise.all([
    loadApprovedRubrics(supabase, brand.id),
    loadProposedRubrics(supabase, brand.id)
  ]);
  return json({ ok: true, approved, proposed });
};
