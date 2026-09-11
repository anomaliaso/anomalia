import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openOrgScope, brandStyleRefusal } from '$lib/server/cli-auth';
import { refineMediaWithoutBrand } from '$lib/server/media-generate';
import { REFINE_MEDIA, statusForFailure } from '@anomalia/api-contracts';

export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request }) => {
  const { scope, error } = await openOrgScope(request);
  if (error) return error;

  const parsed = REFINE_MEDIA.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const refused = brandStyleRefusal(parsed.data.brand_style);
  if (refused) return refused;

  const result = await refineMediaWithoutBrand(scope.supabase, {
    orgId: scope.orgId,
    userId: scope.user.id,
    baseMediaId: parsed.data.base_media_id,
    instruction: parsed.data.instruction,
    count: parsed.data.count,
    model: parsed.data.model
  });

  if (!result.ok) {
    return json(
      {
        error: result.error,
        ...('allowed' in result ? { allowed: result.allowed } : {}),
        ...('limit' in result ? { bytes: result.bytes, limit: result.limit } : {})
      },
      { status: statusForFailure(REFINE_MEDIA, result.error) }
    );
  }

  return json({
    ok: true,
    kind: result.kind,
    media: result.media,
    model: result.model,
    renders: result.renders,
    organization: scope.organization
  });
};
