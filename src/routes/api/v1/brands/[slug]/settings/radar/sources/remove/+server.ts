import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { REMOVE_RADAR_SOURCE, statusForFailure } from '@anomalia/api-contracts';
import { radarSourceValue } from '$lib/server/radar';

// POST /api/v1/brands/:slug/settings/radar/sources/remove — una fonte in meno.
//
// È un POST e non un DELETE perché la fonte si nomina con la coppia `(kind, value)` — la stessa
// chiave unica che l'ha creata, e l'unica cosa che un agente ha in mano subito dopo averla
// aggiunta — e il client del registry non manda un corpo su DELETE.
//
// Il valore passa dallo STESSO normalizzatore dell'aggiunta: `r/coffee` e `coffee` sono la stessa
// fonte, e senza quel passaggio la rimozione risponderebbe "tolta" senza aver tolto niente.

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = REMOVE_RADAR_SOURCE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { kind } = parsed.data;
  const value = radarSourceValue(kind, parsed.data.value);

  const { data: rows } = await supabase
    .from('brand_news_sources')
    .select('id, kind, value')
    .eq('brand_id', brand.id);

  const all = rows ?? [];
  const match = all.find((r) => r.kind === kind && r.value === value);
  if (!match) {
    return json(
      { error: 'not_found', kind, value },
      { status: statusForFailure(REMOVE_RADAR_SOURCE, 'not_found') }
    );
  }

  const { error: deleteError } = await supabase
    .from('brand_news_sources')
    .delete()
    .eq('id', match.id)
    .eq('brand_id', brand.id);

  if (deleteError) {
    return json(
      { error: 'delete_failed', detail: deleteError.message },
      { status: statusForFailure(REMOVE_RADAR_SOURCE, 'delete_failed') }
    );
  }

  return json({ ok: true, kind, value, sources_used: all.length - 1 });
};
