import { swallow } from '$lib/server/swallow';
import type { PageServerLoad } from './$types';
import { syncZernioAnalytics } from '$lib/server/zernio';
import { adsAvailable } from '$lib/server/ads';

const METRIC_KEYS = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'impressions',
  'engagementRate'
] as const;

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand, post } = await parent();
  const published = post.status === 'published';
  const externalPostId = (post.external_post_id as string | null) ?? null;

  if (published && brand.zernio_profile_id) {
    await syncZernioAnalytics(supabase, {
      id: brand.id,
      zernio_profile_id: brand.zernio_profile_id
    }).catch(swallow('sync zernio analytics'));
  }

  const [historyRes, logsRes, campaignsRes] = await Promise.all([
    externalPostId
      ? supabase
          .from('social_post_history')
          .select('id, source, platform, platform_post_url, published_at, metrics, synced_at')
          .eq('brand_id', brand.id)
          .eq('external_post_id', externalPostId)
          .eq('source', 'zernio')
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('publish_logs')
      .select('id, platform, status, error, created_at')
      .eq('brand_id', brand.id)
      .eq('post_id', post.id)
      .order('created_at', { ascending: false })
      .limit(20),
    adsAvailable(brand.plan)
      ? supabase
          .from('ad_campaigns')
          .select('id, name, status, platform, budget_amount, currency')
          .eq('brand_id', brand.id)
          .eq('post_id', post.id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as never[] })
  ]);

  const hist = historyRes.data;
  const campaignIds = (campaignsRes.data ?? []).map((c) => c.id);
  const metricsByCampaign = new Map<
    string,
    { spend: number; impressions: number; clicks: number; ctr: number | null; roas: number | null }
  >();

  if (campaignIds.length) {
    const { data: metrics } = await supabase
      .from('ad_metrics')
      .select('campaign_id, spend, impressions, clicks, ctr, roas, period_end')
      .eq('brand_id', brand.id)
      .in('campaign_id', campaignIds)
      .order('period_end', { ascending: false });
    for (const m of metrics ?? []) {
      if (metricsByCampaign.has(m.campaign_id)) continue;
      metricsByCampaign.set(m.campaign_id, {
        spend: Number(m.spend) || 0,
        impressions: Number(m.impressions) || 0,
        clicks: Number(m.clicks) || 0,
        ctr: m.ctr != null ? Number(m.ctr) : null,
        roas: m.roas != null ? Number(m.roas) : null
      });
    }
  }

  const raw = (hist?.metrics ?? {}) as Record<string, unknown>;
  const metrics: Partial<Record<(typeof METRIC_KEYS)[number], number>> = {};
  for (const k of METRIC_KEYS) {
    const v = Number(raw[k]);
    if (Number.isFinite(v) && v !== 0) metrics[k] = v;
  }

  return {
    published,
    organic: hist
      ? {
          url: hist.platform_post_url ?? post.published_url,
          publishedAt: hist.published_at,
          syncedAt: hist.synced_at,
          platform: hist.platform,
          metrics
        }
      : published
        ? {
            url: post.published_url,
            publishedAt: post.whenISO,
            syncedAt: null,
            platform: post.platform,
            metrics: {}
          }
        : null,
    publishLog: (logsRes.data ?? []).map((r) => ({
      id: r.id,
      platform: r.platform,
      status: r.status,
      error: r.error,
      createdAt: r.created_at
    })),
    paid: (campaignsRes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      platform: c.platform,
      budget: Number(c.budget_amount) || 0,
      currency: c.currency ?? 'EUR',
      ...(metricsByCampaign.get(c.id) ?? {
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: null,
        roas: null
      })
    }))
  };
};
