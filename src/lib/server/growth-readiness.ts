import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evaluateGrowthReadiness,
  growthReadinessMessage,
  type GrowthReadiness,
  type GrowthSnapshot
} from '$lib/growth-readiness';

export {
  evaluateGrowthReadiness,
  growthReadinessMessage,
  type GrowthReadiness,
  type GrowthCheck,
  type GrowthSnapshot
} from '$lib/growth-readiness';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** The three brand columns this needs. Callers that already hold the row can pass it in. */
export type GrowthBrandRow = { slug?: string | null; website?: string | null; content_prefs?: unknown };

/**
 * Load brand signals and evaluate organic-growth readiness.
 *
 * `brandRow` is an optimisation for callers that already have the row in hand — Overview gets
 * it from the layout's brand embed, so passing it drops a round trip from a load that is
 * already 30-odd of them. Omit it and the row is fetched as before.
 */
export async function loadGrowthReadiness(
  supabase: SupabaseClient,
  brandId: string,
  brandRow?: GrowthBrandRow | null
): Promise<GrowthReadiness> {
  const [
    { data: brand },
    { data: kit },
    { count: historyCount },
    { count: competitorCount },
    { count: productCount },
    { count: documentCount },
    { count: handleCount },
    { data: plan },
    { count: gscCount },
    { count: socialCount }
  ] = await Promise.all([
    brandRow
      ? Promise.resolve({ data: brandRow as GrowthBrandRow })
      : supabase.from('brands').select('slug, website, content_prefs').eq('id', brandId).maybeSingle(),
    supabase
      .from('brand_kit')
      .select('about, target_audience, brand_style, ai_character, visual_style')
      .eq('brand_id', brandId)
      .maybeSingle(),
    supabase
      .from('social_post_history')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    supabase.from('competitors').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase
      .from('brand_documents')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    supabase
      .from('brand_social_handles')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    supabase
      .from('editorial_plans')
      .select('id, voice')
      .eq('brand_id', brandId)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('brand_gsc_connections')
      .select('brand_id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    supabase
      .from('social_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'active')
  ]);

  const slug = brand?.slug ?? brandId;
  const prefs = (brand?.content_prefs ?? {}) as AnyRec;
  const character = (kit?.ai_character ?? {}) as AnyRec;
  const planVoice = (plan?.voice ?? {}) as AnyRec;
  const personality = !!(
    String(prefs.personality ?? '').trim() || String(planVoice.personality ?? '').trim()
  );
  const voiceKit = !!(
    character.tone ||
    character.speaking_style ||
    character.personality ||
    kit?.brand_style
  );

  const snap: GrowthSnapshot = {
    slug,
    about: !!String(kit?.about ?? '').trim(),
    audience: !!String(kit?.target_audience ?? '').trim(),
    personality,
    voiceKit,
    historyCount: historyCount ?? 0,
    hasSocialHandles: (handleCount ?? 0) > 0,
    competitorCount: competitorCount ?? 0,
    productCount: productCount ?? 0,
    hasVisualStyle: !!String(kit?.visual_style ?? '').trim(),
    documentCount: documentCount ?? 0,
    hasEditorialPlan: !!plan,
    hasWebsite: !!String((brand as AnyRec | null)?.website ?? '').trim(),
    gscConnected: (gscCount ?? 0) > 0,
    hasSocialAccounts: (socialCount ?? 0) > 0
  };

  return evaluateGrowthReadiness(snap);
}
