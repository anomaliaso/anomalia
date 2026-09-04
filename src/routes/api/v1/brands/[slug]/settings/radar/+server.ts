import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { SET_RADAR_PLATFORM, statusForFailure } from '@anomalia/api-contracts';
import { radarPlatformEnabled, radarPrefsOf } from '$lib/server/radar';
import {
  RADAR_PLATFORM_KEYS,
  hasProRadarLeads,
  radarAllowedKinds,
  radarSourceLimit
} from '$lib/server/plans';

// Dove il Radar guarda, per questo brand. La lettura porta ciò che il piano PERMETTE, non solo
// ciò che è già configurato: Threads, X e LinkedIn appartengono al piano Pro, e un agente che non
// lo sa scopre il confine con un 403 invece di leggerlo prima.

const PRO_ONLY = ['threads', 'x', 'linkedin'];

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const { data: sources } = await supabase
    .from('brand_news_sources')
    .select('id, kind, value, lang, active')
    .eq('brand_id', brand.id)
    .order('created_at', { ascending: true });

  const prefs = radarPrefsOf(brand.content_prefs as Record<string, unknown> | null);
  const rows = sources ?? [];

  return json({
    brand: brand.slug,
    plan: brand.plan,
    platforms: RADAR_PLATFORM_KEYS.map((platform) => ({
      platform,
      enabled: radarPlatformEnabled(prefs, platform, brand.plan),
      plan_locked: PRO_ONLY.includes(platform) && !hasProRadarLeads(brand.plan)
    })),
    sources: rows,
    allowed_kinds: [...radarAllowedKinds(brand.plan)],
    source_limit: radarSourceLimit(brand.plan),
    sources_used: rows.length
  });
};

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = SET_RADAR_PLATFORM.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { platform, enabled } = parsed.data;
  if (PRO_ONLY.includes(platform) && !hasProRadarLeads(brand.plan)) {
    return json(
      { error: 'plan_required', platform, plan: brand.plan },
      { status: statusForFailure(SET_RADAR_PLATFORM, 'plan_required') }
    );
  }

  const prefs = ((brand.content_prefs ?? {}) as Record<string, unknown>);
  const radar = { ...((prefs.radar as Record<string, unknown>) ?? {}) };
  radar.platforms = { ...((radar.platforms as Record<string, boolean>) ?? {}), [platform]: enabled };

  const { error: updateError } = await supabase
    .from('brands')
    .update({ content_prefs: { ...prefs, radar } })
    .eq('id', brand.id);

  if (updateError) {
    return json(
      { error: 'update_failed', detail: updateError.message },
      { status: statusForFailure(SET_RADAR_PLATFORM, 'update_failed') }
    );
  }

  return json({ ok: true, platform, enabled });
};
