import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  AD_MANAGEMENT_FEE_RATE,
  BOOSTABLE_PLATFORMS,
  adsAvailable,
  adsFeatureEnabled,
  approveCampaign,
  feeBreakdown,
  parseAdsSettings,
  pauseCampaign,
  proposeBoostForPost,
  recommendBoostBudget,
  rejectCampaign
} from '$lib/server/ads';

export const load: PageServerLoad = async ({ parent, locals: { supabase, safeGetSession } }) => {
  const { brand, post } = await parent();
  const { user } = await safeGetSession();
  if (!adsFeatureEnabled(user?.email)) throw error(404, 'Not found');
  const adsEnabled = adsAvailable(brand.plan, user?.email);
  const platform = (post.platform ?? '').toLowerCase();
  const canBoost =
    post.status === 'published' &&
    !!post.external_post_id &&
    BOOSTABLE_PLATFORMS.has(platform);

  const settings = parseAdsSettings(brand.ads_settings);

  let metrics: {
    likes: number;
    comments: number;
    shares: number;
    impressions: number;
    views: number;
    engagementRate: number;
  } | null = null;

  if (post.external_post_id) {
    const { data: hist } = await supabase
      .from('social_post_history')
      .select('metrics')
      .eq('brand_id', brand.id)
      .eq('external_post_id', post.external_post_id)
      .eq('source', 'zernio')
      .maybeSingle();
    if (hist?.metrics && typeof hist.metrics === 'object') {
      const m = hist.metrics as Record<string, unknown>;
      metrics = {
        likes: Number(m.likes) || 0,
        comments: Number(m.comments) || 0,
        shares: Number(m.shares) || 0,
        impressions: Number(m.impressions) || 0,
        views: Number(m.views) || 0,
        engagementRate: Number(m.engagementRate) || 0
      };
    }
  }

  const recommended = recommendBoostBudget(settings, metrics);
  const feePreview = feeBreakdown(recommended.amount);

  const { data: campaigns } = adsEnabled
    ? await supabase
        .from('ad_campaigns')
        .select(
          'id, name, status, platform, goal, budget_amount, budget_type, currency, proposal_reason, external_ids, error, approved_at, created_at'
        )
        .eq('brand_id', brand.id)
        .eq('post_id', post.id)
        .order('created_at', { ascending: false })
    : { data: [] as never[] };

  const { data: adAccounts } = adsEnabled
    ? await supabase
        .from('zernio_ad_accounts')
        .select('id, platform, name, status')
        .eq('brand_id', brand.id)
        .eq('status', 'active')
    : { data: [] as never[] };

  return {
    adsEnabled,
    canBoost,
    platform,
    recommended,
    feePreview,
    feeRate: AD_MANAGEMENT_FEE_RATE,
    dailyCap: settings.dailyBudgetCap ?? null,
    campaigns: (campaigns ?? []).map((c) => {
      const ext = (c.external_ids ?? {}) as Record<string, unknown>;
      const budget = Number(c.budget_amount) || 0;
      const fee =
        typeof ext.feeAmount === 'number'
          ? feeBreakdown(typeof ext.platformBudget === 'number' ? ext.platformBudget : budget)
          : feeBreakdown(budget);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        platform: c.platform,
        goal: c.goal,
        budget,
        budgetType: c.budget_type,
        currency: c.currency ?? 'EUR',
        reason: c.proposal_reason,
        error: c.error,
        approvedAt: c.approved_at,
        createdAt: c.created_at,
        fee
      };
    }),
    hasAdAccount: (adAccounts ?? []).length > 0
  };
};

export const actions: Actions = {
  propose: async ({ parent, request, locals: { supabase } }) => {
    const { brand, post } = await parent();
    if (!adsAvailable(brand.plan)) return fail(403, { error: 'ads_not_on_plan' });
    const fd = await request.formData();
    const budgetRaw = fd.get('budgetAmount');
    const budgetAmount =
      budgetRaw != null && String(budgetRaw) !== '' ? Number(budgetRaw) : undefined;
    const result = await proposeBoostForPost(
      supabase,
      {
        id: brand.id,
        plan: brand.plan,
        ads_settings: brand.ads_settings
      },
      post.id,
      { budgetAmount: Number.isFinite(budgetAmount) ? budgetAmount : undefined }
    );
    if (!result.ok) return fail(400, { error: result.error });
    return { proposed: result.campaignId };
  },

  approve: async ({ parent, request, locals: { supabase } }) => {
    const { brand } = await parent();
    if (!adsAvailable(brand.plan)) return fail(403, { error: 'ads_not_on_plan' });
    const fd = await request.formData();
    const campaignId = String(fd.get('campaignId') ?? '');
    if (!campaignId) return fail(400, { error: 'missing_campaign' });
    const budgetRaw = fd.get('budgetAmount');
    const budgetAmount =
      budgetRaw != null && String(budgetRaw) !== '' ? Number(budgetRaw) : undefined;
    const result = await approveCampaign(
      supabase,
      {
        id: brand.id,
        plan: brand.plan,
        zernio_profile_id: brand.zernio_profile_id,
        ads_settings: brand.ads_settings
      },
      campaignId,
      { budgetAmount: Number.isFinite(budgetAmount) ? budgetAmount : undefined }
    );
    if (!result.ok) return fail(400, { error: result.error });
    return { approved: result.zernioAdId };
  },

  reject: async ({ parent, request, locals: { supabase } }) => {
    const { brand } = await parent();
    const fd = await request.formData();
    const campaignId = String(fd.get('campaignId') ?? '');
    await rejectCampaign(supabase, brand.id, campaignId);
    return { rejected: true };
  },

  pause: async ({ parent, request, locals: { supabase } }) => {
    const { brand } = await parent();
    const fd = await request.formData();
    const campaignId = String(fd.get('campaignId') ?? '');
    const result = await pauseCampaign(supabase, brand.id, campaignId);
    if (!result.ok) return fail(400, { error: result.error });
    return { paused: true };
  }
};
