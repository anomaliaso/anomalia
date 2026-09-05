import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { generateBrandCarousel } from '$lib/server/media-generate';
import { GENERATE_CAROUSEL, statusForFailure } from '@anomalia/api-contracts';

// Otto slide di fila sono otto render: sotto il minuto, ma non sotto il default.
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const parsed = GENERATE_CAROUSEL.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const result = await generateBrandCarousel(supabase, {
    brandId: brand.id,
    userId: user.id,
    brief: parsed.data.brief,
    slides: parsed.data.slides,
    aspectRatio: parsed.data.aspect_ratio,
    model: parsed.data.model,
    title: parsed.data.title
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
    renders: result.renders
  });
};
