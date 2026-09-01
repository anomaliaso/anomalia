import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { approveRubrics, loadApprovedRubrics } from '$lib/server/rubrics';

// Client approval of a proposed batch. Body:
//   { picks: [{ id, edits?: { name?, promise?, strategic_role?, format?, cadence?, differentiation?, art_direction? } }] }
// The selected proposals (with the client's edits) become the brand's NEW approved set; the
// previous approved set is superseded; unselected proposals are rejected.
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const body = await request.json().catch(() => ({}));
  const picks = Array.isArray(body?.picks)
    ? body.picks
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((p: any) => typeof p?.id === 'string' && p.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => ({ id: p.id as string, edits: p.edits ?? undefined }))
    : [];
  if (!picks.length) return json({ error: 'picks is required (at least one rubric id)' }, { status: 400 });

  const { approved } = await approveRubrics(supabase, brand.id, picks);
  if (!approved) return json({ error: 'No proposed rubric matched the given ids' }, { status: 400 });
  return json({ ok: true, approved, rubrics: await loadApprovedRubrics(supabase, brand.id) });
};
