import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { generateBrandImages } from '$lib/server/media-generate';
import { GENERATE_IMAGE, statusForFailure } from '@anomalia/api-contracts';

// Quattro immagini di fila stanno sotto il minuto, ma non sotto il default.
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const parsed = GENERATE_IMAGE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const result = await generateBrandImages(supabase, {
    brandId: brand.id,
    userId: user.id,
    prompt: parsed.data.prompt,
    count: parsed.data.count,
    aspectRatio: parsed.data.aspect_ratio,
    model: parsed.data.model,
    title: parsed.data.title
  });

  if (!result.ok) {
    // L'elenco dei modelli ammessi viaggia col rifiuto: senza, l'agente sa solo di aver sbagliato.
    return json(
      { error: result.error, ...('allowed' in result ? { allowed: result.allowed } : {}) },
      { status: statusForFailure(GENERATE_IMAGE, result.error) }
    );
  }

  return json({ ok: true, media: result.media, model: result.model, renders: result.renders });
};
