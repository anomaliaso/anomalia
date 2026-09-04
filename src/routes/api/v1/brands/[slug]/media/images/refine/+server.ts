import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { refineBrandImage } from '$lib/server/media-generate';
import { REFINE_IMAGE, statusForFailure } from '@anomalia/api-contracts';

export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const parsed = REFINE_IMAGE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const result = await refineBrandImage(supabase, {
    brandId: brand.id,
    userId: user.id,
    // L'istruzione È il prompt: `baseMediaId` rende la richiesta una modifica, e il modello legge
    // "cosa cambiare" avendo davanti l'immagine di partenza.
    prompt: parsed.data.instruction,
    baseMediaId: parsed.data.base_media_id,
    count: parsed.data.count,
    model: parsed.data.model,
    title: parsed.data.title
  });

  if (!result.ok) {
    return json(
      { error: result.error, ...('allowed' in result ? { allowed: result.allowed } : {}) },
      { status: statusForFailure(REFINE_IMAGE, result.error) }
    );
  }

  return json({ ok: true, media: result.media, model: result.model });
};
