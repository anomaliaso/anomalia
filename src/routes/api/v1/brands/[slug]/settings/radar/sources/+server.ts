import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { ADD_RADAR_SOURCE, statusForFailure } from '@anomalia/api-contracts';
import { radarSourceValue } from '$lib/server/radar';
import { isRadarKindAllowed, radarSourceLimit } from '$lib/server/plans';

// POST /api/v1/brands/:slug/settings/radar/sources — una fonte in più da guardare.
//
// Tre cancelli, e nessuno è opzionale: il tipo deve essere permesso dal piano, il valore deve
// avere la forma che quel tipo richiede, e il brand deve avere ancora posto. Una fonte che c'è
// già non è un errore: l'upsert la lascia com'è, e `added: false` lo dice.

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = ADD_RADAR_SOURCE.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { kind } = parsed.data;
  const value = radarSourceValue(kind, parsed.data.value);
  const lang = (parsed.data.lang ?? 'auto').slice(0, 5) || 'auto';
  const fail = (name: string, extra: Record<string, unknown> = {}) =>
    json({ error: name, ...extra }, { status: statusForFailure(ADD_RADAR_SOURCE, name) });

  if (!isRadarKindAllowed(kind, brand.plan)) {
    return fail('plan_required', { kind, plan: brand.plan });
  }
  if (!value) {
    return fail('invalid_value', { kind, reason: 'empty after normalisation' });
  }
  if (kind === 'rss' && !/^https?:\/\//i.test(value)) {
    return fail('invalid_value', { kind, reason: 'rss must be an http(s) URL' });
  }

  const limit = radarSourceLimit(brand.plan);
  const { data: existing } = await supabase
    .from('brand_news_sources')
    .select('id, kind, value')
    .eq('brand_id', brand.id);

  const rows = existing ?? [];
  const already = rows.some((r) => r.kind === kind && r.value === value);
  if (!already && rows.length >= limit) {
    return fail('source_limit', { limit, sources_used: rows.length, plan: brand.plan });
  }

  if (!already) {
    const { error: insertError } = await supabase
      .from('brand_news_sources')
      .insert({ brand_id: brand.id, kind, value, lang });
    if (insertError) {
      return fail('insert_failed', { detail: insertError.message });
    }
  }

  return json({
    ok: true,
    kind,
    value,
    lang,
    added: !already,
    sources_used: rows.length + (already ? 0 : 1),
    source_limit: limit
  });
};
