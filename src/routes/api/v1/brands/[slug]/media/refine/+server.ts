import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { refineBrandMedia } from '$lib/server/media-generate';
import { REFINE_MEDIA, statusForFailure } from '@anomalia/api-contracts';

export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const parsed = REFINE_MEDIA.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const result = await refineBrandMedia(supabase, {
    brandId: brand.id,
    userId: user.id,
    baseMediaId: parsed.data.base_media_id,
    instruction: parsed.data.instruction,
    count: parsed.data.count,
    model: parsed.data.model,
    brandStyle: parsed.data.brand_style,
    title: parsed.data.title
  });

  if (!result.ok) {
    return json(
      { error: result.error, ...('allowed' in result ? { allowed: result.allowed } : {}) },
      { status: statusForFailure(REFINE_MEDIA, result.error) }
    );
  }

  return json({
    ok: true,
    kind: result.kind,
    media: result.media,
    model: result.model,
    renders: result.renders
  });
};
