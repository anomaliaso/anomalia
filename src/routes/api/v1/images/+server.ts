import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, gateOrgAiAction, apiKeyIsBrandScoped } from '$lib/server/cli-auth';
import { ensureOrgForUser } from '$lib/server/org';
import { generateImagesWithoutBrand } from '$lib/server/media-generate';
import { GENERATE_IMAGE, statusForFailure } from '@anomalia/api-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

// Lo stesso tetto della rotta sotto il brand: quattro immagini di fila stanno sotto il minuto, ma
// non sotto il default.
export const config = { maxDuration: 300 };

/**
 * Chi ha pagato, per nome. La risposta lo dice perché il chiamante non l'ha scelto: `slug` assente
 * significa che l'organizzazione l'abbiamo risolta noi, e un addebito che nessuno ha nominato è un
 * addebito che nessuno controlla. Andrea ha visto agenti scegliere un brand a caso pur di avere
 * un'immagine — un gatto poteva finire sul conto di un cliente vero.
 */
async function nameOrg(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ id: string; name: string | null }> {
  const { data } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();

  return { id: orgId, name: (data?.name as string | null | undefined) ?? null };
}

export const POST: RequestHandler = async ({ request }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  // Una chiave ristretta a certi brand è una restrizione che l'utente ha scelto: qui, dove nessun
  // brand viene nominato, non c'è niente da restringere — quindi si rifiuta invece di allargarla.
  if (apiKeyIsBrandScoped(apiKey)) {
    return json({ error: 'brand_scoped_key' }, { status: 403 });
  }

  // La stessa regola che decide dove atterra un brand nuovo: pagante prima, poi la più vecchia.
  // Deterministica di proposito — un utente con più organizzazioni deve ottenere sempre la stessa.
  const orgId = await ensureOrgForUser(supabase, user as never);
  if (!orgId) return json({ error: 'no_organization' }, { status: 500 });

  const gate = await gateOrgAiAction(orgId, apiKey);
  if (gate) return gate;

  const parsed = GENERATE_IMAGE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.brand_style) {
    return json(
      {
        error: 'brand_style_needs_a_brand',
        reason: 'brand_style governs a brand look, and no brand was named — pass a slug, or drop brand_style.'
      },
      { status: statusForFailure(GENERATE_IMAGE, 'brand_style_needs_a_brand') }
    );
  }

  const result = await generateImagesWithoutBrand(supabase, {
    orgId,
    userId: user.id,
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
    organization: await nameOrg(supabase, orgId),
    cost_usd: result.costUsd
  });
};
