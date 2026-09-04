import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { appOrigin } from '$lib/server/app-url';
import { CREATE_SHARE, LIST_SHARES, statusForFailure } from '@anomalia/api-contracts';
import { createSharedView, currentShareMonth, listSharedViews, shareFailure } from '$lib/server/shared-views';

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  try {
    return json({ shares: await listSharedViews(supabase, brand.id) });
  } catch (e) {
    const failure = shareFailure(e);
    if (!failure) throw e;
    return json(failure, { status: statusForFailure(LIST_SHARES, failure.error) });
  }
};

export const POST: RequestHandler = async ({ request, params, url }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = CREATE_SHARE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  try {
    const share = await createSharedView(supabase, {
      brand,
      authorId: user.id,
      view: input.view,
      month: input.month ?? currentShareMonth(brand.timezone),
      expiresInDays: input.expires_in_days
    });

    return json({
      ok: true,
      id: share.id,
      view: share.view,
      month: share.month,
      url: `${appOrigin(url)}/share/${share.token}`,
      token: share.token,
      expires_at: share.expires_at
    });
  } catch (e) {
    const failure = shareFailure(e);
    if (!failure) throw e;
    return json(failure, { status: statusForFailure(CREATE_SHARE, failure.error) });
  }
};
