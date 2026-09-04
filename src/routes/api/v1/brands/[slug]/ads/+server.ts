import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import {
  approveCampaign,
  deleteCampaign,
  duplicateCampaign,
  getPaidSummary,
  proposeBoosts,
  proposeStandalone,
  rankBoostCandidates,
  rejectCampaign,
  pauseCampaign,
  setCampaignStatus,
  setCreativeStatus,
  syncAdAccounts,
  syncAdMetrics,
  adsAvailable,
  adsFeatureEnabled,
  type AdGoal
} from '$lib/server/ads';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug!, apiKey);
  if (brandError) return brandError;
  if (!adsFeatureEnabled()) return json({ error: 'Not found' }, { status: 404 });
  if (!adsAvailable(brand.plan)) return json({ error: 'ads_not_on_plan' }, { status: 403 });

  if (url.searchParams.get('sync') === '1') {
    await syncAdAccounts(supabase, brand).catch((error) => { swallow('sync ad accounts', error); return 0; });
    await syncAdMetrics(supabase, brand.id).catch((error) => { swallow('sync ad metrics', error); return 0; });
  }

  const [summary, candidates] = await Promise.all([
    getPaidSummary(supabase, brand.id),
    rankBoostCandidates(supabase, brand.id, { limit: 10 })
  ]);

  const { data: adAccounts } = await supabase
    .from('zernio_ad_accounts')
    .select('id, platform, name, currency, status, zernio_ad_account_id')
    .eq('brand_id', brand.id);

  return json({ summary, candidates, adAccounts: adAccounts ?? [] });
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug!, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;
  if (!adsFeatureEnabled()) return json({ error: 'Not found' }, { status: 404 });
  if (!adsAvailable(brand.plan)) return json({ error: 'ads_not_on_plan' }, { status: 403 });

  // Il registry dichiara i campi propri di ogni azione dentro `extra`; il CLI li manda in cima.
  // Sono lo stesso corpo, appiattito qui una volta sola.
  const sent = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const body = { ...sent, ...((sent.extra as Record<string, unknown>) ?? {}) };
  const action = String(body.action ?? '');

  // activated_at/status feed the credits window: approving spends credits (12% management fee).
  const { data: extra } = await supabase
    .from('brands')
    .select('ads_settings, zernio_profile_id, activated_at, status')
    .eq('id', brand.id)
    .maybeSingle();

  const fullBrand = {
    id: brand.id,
    plan: brand.plan,
    zernio_profile_id: extra?.zernio_profile_id ?? brand.zernio_profile_id ?? null,
    ads_settings: extra?.ads_settings ?? (brand as { ads_settings?: unknown }).ads_settings,
    activated_at: extra?.activated_at ?? null,
    status: extra?.status ?? brand.status
  };

  switch (action) {
    case 'propose': {
      const result = await proposeBoosts(supabase, fullBrand);
      return json({ ok: true, ...result });
    }
    case 'approve': {
      const campaignId = String(body.campaignId ?? '');
      if (!campaignId) return json({ error: 'missing_campaignId' }, { status: 400 });
      const result = await approveCampaign(supabase, fullBrand, campaignId, {
        budgetAmount: body.budgetAmount != null ? Number(body.budgetAmount) : undefined,
        goal: body.goal as AdGoal | undefined
      });
      if (!result.ok) return json({ error: result.error }, { status: 400 });
      return json({ ok: true, zernioAdId: result.zernioAdId });
    }
    case 'reject': {
      await rejectCampaign(supabase, brand.id, String(body.campaignId ?? ''));
      return json({ ok: true });
    }
    case 'duplicate': {
      const result = await duplicateCampaign(supabase, brand.id, String(body.campaignId ?? ''));
      if (!result.ok) return json({ error: result.error }, { status: 400 });
      return json({ ok: true, id: result.id, copiedCampaignId: result.copiedCampaignId });
    }
    case 'delete': {
      const result = await deleteCampaign(supabase, brand.id, String(body.campaignId ?? ''));
      if (!result.ok) return json({ error: result.error }, { status: 400 });
      return json({ ok: true });
    }
    case 'pause': {
      const result = await pauseCampaign(supabase, brand.id, String(body.campaignId ?? ''));
      if (!result.ok) return json({ error: result.error }, { status: 400 });
      return json({ ok: true });
    }
    case 'resume': {
      const result = await setCampaignStatus(supabase, brand.id, String(body.campaignId ?? ''), 'active');
      if (!result.ok) return json({ error: result.error }, { status: 400 });
      return json({ ok: true });
    }
    // One switch for the whole campaign, one per creative. Same shape as the dashboard toggle:
    // adId omitted → campaign, adId present → that single ad (the others keep running).
    case 'toggle': {
      const result = String(body.adId ?? '')
        ? await setCreativeStatus(
            supabase,
            brand.id,
            String(body.campaignId ?? ''),
            String(body.adId ?? ''),
            String(body.next ?? '') === 'active' ? 'active' : 'paused'
          )
        : await setCampaignStatus(
            supabase,
            brand.id,
            String(body.campaignId ?? ''),
            String(body.next ?? '') === 'active' ? 'active' : 'paused'
          );
      if (!result.ok) return json({ error: result.error }, { status: 400 });
      return json({ ok: true, next: String(body.next ?? '') === 'active' ? 'active' : 'paused' });
    }
    case 'sync': {
      const accounts = await syncAdAccounts(supabase, fullBrand);
      const metrics = await syncAdMetrics(supabase, brand.id);
      return json({ ok: true, accounts, metrics });
    }
    case 'create': {
      const result = await proposeStandalone(supabase, fullBrand, {
        platform: String(body.platform ?? 'metaads'),
        name: String(body.name ?? 'Standalone ad'),
        goal: (body.goal as AdGoal) ?? 'traffic',
        budgetAmount: body.budgetAmount != null ? Number(body.budgetAmount) : undefined,
        campaignType:
          body.campaignType === 'SEARCH' || body.campaignType === 'DISPLAY'
            ? body.campaignType
            : undefined,
        adAccountId: body.adAccountId ? String(body.adAccountId) : undefined,
        targeting: Array.isArray(body.keywords)
          ? { keywords: body.keywords.map((k) => ({ text: String(k) })) }
          : undefined,
        creative: {
          headline: String(body.headline ?? ''),
          headlines: [
            String(body.headline ?? ''),
            ...(Array.isArray(body.headlines) ? body.headlines.map(String) : [])
          ].filter(Boolean),
          body: body.body ? String(body.body) : undefined,
          descriptions: [
            body.body ? String(body.body) : '',
            ...(Array.isArray(body.descriptions) ? body.descriptions.map(String) : [])
          ].filter(Boolean),
          imageUrl: body.imageUrl ? String(body.imageUrl) : undefined,
          // Google Responsive Display needs both ratios.
          squareImageUrl: body.squareImageUrl ? String(body.squareImageUrl) : undefined,
          businessName: body.businessName ? String(body.businessName) : undefined,
          landingPageUrl: body.landingPageUrl ? String(body.landingPageUrl) : undefined,
          linkUrl: body.landingPageUrl ? String(body.landingPageUrl) : undefined
        }
      });
      if (!result.ok) return json({ error: result.error }, { status: 400 });
      return json({ ok: true, id: result.id });
    }
    default:
      return json({ error: 'unknown_action' }, { status: 400 });
  }
};
