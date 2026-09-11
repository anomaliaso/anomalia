import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openOrgScope, brandStyleRefusal } from '$lib/server/cli-auth';
import { generateImagesWithoutBrand } from '$lib/server/media-generate';
import { GENERATE_IMAGE, statusForFailure } from '@anomalia/api-contracts';

// Lo stesso tetto della rotta sotto il brand: quattro immagini di fila stanno sotto il minuto, ma
// non sotto il default.
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request }) => {
  const { scope, error } = await openOrgScope(request);
  if (error) return error;

  const parsed = GENERATE_IMAGE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const refused = brandStyleRefusal(parsed.data.brand_style);
  if (refused) return refused;

  const result = await generateImagesWithoutBrand(scope.supabase, {
    orgId: scope.orgId,
    userId: scope.user.id,
    prompt: parsed.data.prompt,
    count: parsed.data.count,
    aspectRatio: parsed.data.aspect_ratio,
    model: parsed.data.model
  });

  if (!result.ok) {
    // L'elenco dei modelli ammessi viaggia col rifiuto: senza, l'agente sa solo di aver sbagliato.
    return json(
      { error: result.error, ...('allowed' in result ? { allowed: result.allowed } : {}) },
      { status: statusForFailure(GENERATE_IMAGE, result.error) }
    );
  }

  return json({
    ok: true,
    media: result.media,
    model: result.model,
    renders: result.renders,
    organization: scope.organization,
    cost_usd: result.costUsd
  });
};
