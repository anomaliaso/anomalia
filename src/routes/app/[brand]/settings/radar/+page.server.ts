import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
  radarPrefsOf,
  radarPlatformEnabled,
  radarSourceValue,
  type RadarPlatformKey
} from '$lib/server/radar';
import {
  RADAR_BASE_KINDS,
  RADAR_PLATFORM_KEYS,
  RADAR_PRO_LEAD_KINDS,
  type RadarSourceKind
} from '$lib/plans';

/** Un elenco solo dei tipi validi: quello ricopiato qui dentro era la quarta copia. */
const RADAR_ALL_KINDS: readonly RadarSourceKind[] = [...RADAR_BASE_KINDS, ...RADAR_PRO_LEAD_KINDS];
import { radarSourceLimit, isRadarKindAllowed, hasProRadarLeads } from '$lib/server/plans';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandBySlug(supabase: any, slug: string) {
  const { data } = await supabase.from('brands').select('id, content_prefs, plan').eq('slug', slug).maybeSingle();
  return data;
}

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand } = await parent();

  const [{ data: sources }, { data: brandRow }] = await Promise.all([
    supabase
      .from('brand_news_sources')
      .select('id, kind, value, lang, active')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: true }),
    supabase.from('brands').select('content_prefs').eq('id', brand.id).maybeSingle()
  ]);

  const radar = radarPrefsOf(brandRow?.content_prefs);
  const platforms = Object.fromEntries(
    RADAR_PLATFORM_KEYS.map((k) => [k, radarPlatformEnabled(radar, k, brand.plan)])
  ) as Record<RadarPlatformKey, boolean>;

  return {
    radarSources: sources ?? [],
    radar,
    platforms,
    hasProRadarLeads: hasProRadarLeads(brand.plan),
    sourceLimit: radarSourceLimit(brand.plan)
  };
};

export const actions: Actions = {
  togglePlatform: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const key = String(fd.get('platform') ?? '') as RadarPlatformKey;
    if (!(RADAR_PLATFORM_KEYS as readonly string[]).includes(key)) return fail(400, { error: 'Invalid platform' });
    if ((key === 'threads' || key === 'x' || key === 'linkedin') && !hasProRadarLeads(brand.plan)) {
      return fail(403, { error: 'pro_leads_required' });
    }
    const enabled = String(fd.get('enabled') ?? '') === 'true';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = ((brand.content_prefs as any) ?? {}) as Record<string, unknown>;
    const radar = { ...((prefs.radar as Record<string, unknown>) ?? {}) };
    const platforms = { ...((radar.platforms as Record<string, boolean>) ?? {}) };
    platforms[key] = enabled;
    radar.platforms = platforms;
    const { error } = await supabase
      .from('brands')
      .update({ content_prefs: { ...prefs, radar } })
      .eq('id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { saved: true };
  },

  radarAddSource: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const kind = String(fd.get('kind') ?? '');
    const value = String(fd.get('value') ?? '').trim();
    const lang = String(fd.get('lang') ?? 'auto').slice(0, 5) || 'auto';
    if (!RADAR_ALL_KINDS.includes(kind as RadarSourceKind) || !value) {
      return fail(400, { error: 'Invalid source' });
    }
    if (!isRadarKindAllowed(kind, brand.plan)) {
      return fail(403, { error: 'pro_leads_required' });
    }
    if (kind === 'rss' && !/^https?:\/\//i.test(value)) return fail(400, { error: 'RSS must be a URL' });
    const limit = radarSourceLimit(brand.plan);
    const { count } = await supabase
      .from('brand_news_sources')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id);
    if ((count ?? 0) >= limit) return fail(403, { error: `source_limit`, limit });
    const { error } = await supabase.from('brand_news_sources').upsert(
      {
        brand_id: brand.id,
        kind,
        value: radarSourceValue(kind, value),
        lang
      },
      { onConflict: 'brand_id,kind,value', ignoreDuplicates: true }
    );
    if (error) return fail(500, { error: error.message });
    return { saved: true };
  },

  radarToggleSource: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const active = String(fd.get('active') ?? '') === 'true';
    if (active) {
      const { data: src } = await supabase
        .from('brand_news_sources')
        .select('kind')
        .eq('id', id)
        .eq('brand_id', brand.id)
        .maybeSingle();
      if (src && !isRadarKindAllowed(String(src.kind), brand.plan)) {
        return fail(403, { error: 'pro_leads_required' });
      }
    }
    const { error } = await supabase
      .from('brand_news_sources')
      .update({ active })
      .eq('id', id)
      .eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { saved: true };
  },

  radarDeleteSource: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const { error } = await supabase
      .from('brand_news_sources')
      .delete()
      .eq('id', String(fd.get('id') ?? ''))
      .eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { saved: true };
  }
};
