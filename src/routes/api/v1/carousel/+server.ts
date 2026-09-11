import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openOrgScope } from '$lib/server/cli-auth';
import { generateCarouselWithoutBrand } from '$lib/server/media-generate';
import { GENERATE_CAROUSEL, statusForFailure } from '@anomalia/api-contracts';

// Otto slide di fila sono otto render: sotto il minuto, ma non sotto il default.
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request }) => {
  const { scope, error } = await openOrgScope(request);
  if (error) return error;

  const parsed = GENERATE_CAROUSEL.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const result = await generateCarouselWithoutBrand(scope.supabase, {
    orgId: scope.orgId,
    userId: scope.user.id,
    brief: parsed.data.brief,
    slides: parsed.data.slides,
    aspectRatio: parsed.data.aspect_ratio,
    model: parsed.data.model
  });

  if (!result.ok) {
    return json(
      { error: result.error, ...('allowed' in result ? { allowed: result.allowed } : {}) },
      { status: statusForFailure(GENERATE_CAROUSEL, result.error) }
    );
  }

  return json({
    ok: true,
    media: result.media,
    continuity_tokens: result.continuityTokens,
    model: result.model,
    renders: result.renders,
    organization: scope.organization
  });
};
