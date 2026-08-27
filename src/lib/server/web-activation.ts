import type { SupabaseClient } from '@supabase/supabase-js';

// Web activation funnel — read-side status for the Web hub panel. Zero AI:
// the three steps are "connect an active website/blog", "connect Google Search
// Console", "run the first GEO audit".

export type WebActivationStepKey = 'website' | 'gsc' | 'geo';

export type WebActivationStatus = {
  hasWebsite: boolean;
  gscConnected: boolean;
  hasGeoAudit: boolean;
  /** Ordered labels of the steps still to do (empty when the loop is active). */
  nextSteps: string[];
};

export type WebActivationStep = {
  key: WebActivationStepKey;
  label: string;
  done: boolean;
  /** App path to complete the step (includes /app/{slug}/…). */
  href: string;
};

const STEP_LABELS: Record<WebActivationStepKey, string> = {
  website: 'Connect an active website / blog',
  gsc: 'Connect Google Search Console',
  geo: 'Run the first GEO audit'
};

export async function getWebActivationStatus(
  admin: SupabaseClient,
  brandId: string
): Promise<WebActivationStatus> {
  const [{ data: brand }, { count: gscCount }, { count: geoCount }] = await Promise.all([
    admin.from('brands').select('website').eq('id', brandId).maybeSingle(),
    admin
      .from('brand_gsc_connections')
      .select('brand_id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    admin.from('brand_geo_audits').select('id', { count: 'exact', head: true }).eq('brand_id', brandId)
  ]);

  const hasWebsite = !!String((brand as { website?: unknown } | null)?.website ?? '').trim();
  const gscConnected = (gscCount ?? 0) > 0;
  const hasGeoAudit = (geoCount ?? 0) >= 1;

  const order: WebActivationStepKey[] = ['website', 'gsc', 'geo'];
  const done = { website: hasWebsite, gsc: gscConnected, geo: hasGeoAudit };
  const nextSteps = order.filter((k) => !done[k]).map((k) => STEP_LABELS[k]);

  return { hasWebsite, gscConnected, hasGeoAudit, nextSteps };
}

/** Ordered activation checklist with destination app paths (first undone step first). */
export async function firstSteps(
  admin: SupabaseClient,
  brandId: string
): Promise<WebActivationStep[]> {
  const { data: brand } = await admin.from('brands').select('slug').eq('id', brandId).maybeSingle();
  const slug = (brand as { slug?: string } | null)?.slug ?? brandId;
  const status = await getWebActivationStatus(admin, brandId);
  const base = `/app/${slug}`;
  return [
    { key: 'website', label: STEP_LABELS.website, done: status.hasWebsite, href: `${base}/site` },
    {
      key: 'gsc',
      label: STEP_LABELS.gsc,
      done: status.gscConnected,
      href: `${base}/settings/search-console`
    },
    { key: 'geo', label: STEP_LABELS.geo, done: status.hasGeoAudit, href: `${base}/geo` }
  ];
}
