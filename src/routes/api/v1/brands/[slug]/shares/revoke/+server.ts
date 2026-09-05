import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { REVOKE_SHARE, statusForFailure } from '@anomalia/api-contracts';
import { revokeSharedView, shareFailure } from '$lib/server/shared-views';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = REVOKE_SHARE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const revoked = await revokeSharedView(supabase, brand.id, parsed.data.id);
    if (!revoked) {
      return json({ error: 'share_not_found' }, { status: statusForFailure(REVOKE_SHARE, 'share_not_found') });
    }

    return json({ ok: true, id: revoked.id, revoked_at: revoked.revoked_at });
  } catch (e) {
    const failure = shareFailure(e);
    if (!failure) throw e;
    return json(failure, { status: statusForFailure(REVOKE_SHARE, failure.error) });
  }
};
