import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { hasAds as planHasAds } from '$lib/plans';
import { feeBreakdown } from '$lib/ads-fee';
import { isAdsPreviewUser } from '$lib/server/internal-users';
import {
  boostPost,
  createStandaloneAd,
  deleteAd as zernioDeleteAd,
  deleteCampaign as zernioDeleteCampaign,
  duplicateCampaign as zernioDuplicateCampaign,
  getAd,
  getAdAnalytics,
  listAdAccounts,
  listAds,
  updateAd,
  updateCampaignStatus,
  type AdGoal,
  type AdTargeting,
  type AdCreativeVariant,
  type CreateStandaloneAdInput,
  type ZernioAd,
  type ZernioAdAccount
} from '$lib/server/zernio-ads';
import { publisher } from '$lib/server/publishing';
import { diagnoseFatigue, type AdMetricPoint } from '$lib/server/ads-fatigue';
// Re-exported so a caller reading `campaign.fatigue` gets the type from the same module as the
// summary that produced it.
export { fatigueBrief, type FatigueDiagnosis, type FatigueDiagnosisId } from '$lib/server/ads-fatigue';
import {
  canAffordAdsCredits,
  chargeAdsCredits,
  creditedSpend,
  creditsDue,
  creditsForSpend
} from '$lib/server/ads-credits';

export { AD_MANAGEMENT_FEE_RATE, feeBreakdown, creditsForSpend } from '$lib/ads-fee';
// Re-exported so callers get the goal/targeting types from the same module as the functions
// that take them (the ads routes already import them from here).
export type { AdGoal, AdTargeting } from '$lib/server/zernio-ads';

/**
 * Global kill switch for the paid-ads surface (FEATURE_ADS on Vercel), mirrored to the client as
 * `flags.ads` by the brand layout. Default OFF. Orthogonal to hasAds(plan): the plan decides who
 * may use ads, this decides whether the feature exists at all — so an unreleased surface can't be
 * reached by typing the URL, and one env var turns the whole thing off in an incident.
 * Preview allowlist users (Andrea / Marco) always see the surface for dogfooding.
 */
export function adsFeatureEnabled(email?: string | null): boolean {
  return env.FEATURE_ADS === 'true' || isAdsPreviewUser(email);
}

/**
 * The ONLY ads gate server code should use: the feature must be switched on AND the plan must
 * include it. Every mutating function below goes through this, so a direct form POST or a stale
 * client cannot reach an ads action while the flag is off — the page 404s are just the polite
 * layer on top. Preview allowlist users bypass both gates for dogfooding.
 */
export function adsAvailable(plan: string | null | undefined, email?: string | null): boolean {
  if (!adsFeatureEnabled(email)) return false;
  if (isAdsPreviewUser(email)) return true;
  return planHasAds(plan);
}

export type AdsSettings = {
  dailyBudgetCap?: number;
  monthlyBudgetCap?: number;
  defaultCountries?: string[];
  defaultCurrency?: string;
  dsaBeneficiary?: string;
  dsaPayor?: string;
};

/**
 * Platforms that support boosting an organic post via Zernio.
 * Social ads are Meta-only for now — only IG/FB posts can be boosted.
 */
export const BOOSTABLE_PLATFORMS = new Set(['instagram', 'facebook']);

/** Ad-network keys for the Social ads channel. Meta only until other networks ship. */
export const SOCIAL_ADS_PLATFORMS = ['metaads'] as const;

/**
 * The goals we can actually deliver, and the single source of truth for the form, the AI prompt
 * and the server-side guard.
 *
 * ponytail: `lead_generation` and `conversions` are deliberately absent. Meta requires a
 * `leadGenFormId` for the first and `promotedObject.pixelId` + a conversion event for the second,
 * and we send neither — so the platform rejected the campaign AFTER the user had approved the
 * spend, with no way forward but to delete it and start over. Add them back together with those
 * fields: lead forms via POST /v1/ads/lead-forms, pixels from the brand's connected dataset.
 */
export const SUPPORTED_GOALS = new Set<string>(['traffic', 'engagement', 'awareness', 'video_views']);

/** Zernio ads platform key for a social platform / ads network. */
export function toAdsPlatform(platform: string): string {
  const p = platform.toLowerCase();
  if (p === 'instagram' || p === 'facebook' || p === 'metaads') return 'metaads';
  if (p === 'tiktok' || p === 'tiktokads') return 'tiktokads';
  if (p === 'linkedin' || p === 'linkedinads') return 'linkedinads';
  if (p === 'x' || p === 'twitter' || p === 'xads') return 'xads';
  if (p === 'pinterest' || p === 'pinterestads') return 'pinterestads';
  if (p === 'google' || p === 'googleads') return 'googleads';
  return p;
}

/**
 * Zernio platform key for a stored campaign.platform. Zernio's duplicate/delete/status endpoints
 * take their own enum (facebook/instagram/tiktok/linkedin), not the ad-network keys we store.
 * Returns undefined for platforms Zernio does not address that way (google/x/pinterest: 501).
 */
export function toZernioPlatform(platform: string): 'facebook' | 'instagram' | 'tiktok' | 'linkedin' | undefined {
  const p = platform.toLowerCase();
  if (p === 'metaads' || p === 'facebook' || p === 'instagram') return 'facebook';
  if (p === 'tiktokads' || p === 'tiktok') return 'tiktok';
  if (p === 'linkedinads' || p === 'linkedin') return 'linkedin';
  return undefined;
}

export function parseAdsSettings(raw: unknown): AdsSettings {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const num = (x: unknown) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const countries = Array.isArray(o.defaultCountries)
    ? o.defaultCountries.map(String).filter((c) => /^[A-Z]{2}$/i.test(c)).map((c) => c.toUpperCase())
    : undefined;
  return {
    dailyBudgetCap: num(o.dailyBudgetCap),
    monthlyBudgetCap: num(o.monthlyBudgetCap),
    defaultCountries: countries?.length ? countries : undefined,
    defaultCurrency: typeof o.defaultCurrency === 'string' ? o.defaultCurrency : undefined,
    dsaBeneficiary: typeof o.dsaBeneficiary === 'string' ? o.dsaBeneficiary : undefined,
    dsaPayor: typeof o.dsaPayor === 'string' ? o.dsaPayor : undefined
  };
}

export type BoostCandidate = {
  postId: string | null;
  historyId: string | null;
  externalPostId: string | null;
  platform: string;
  caption: string | null;
  mediaUrl: string | null;
  publishedAt: string | null;
  url: string | null;
  score: number;
  metrics: {
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    impressions: number;
    views: number;
    engagementRate: number;
  };
  reason: string;
};

function engagementScore(m: BoostCandidate['metrics']): number {
  const eng = m.likes + m.comments * 2 + m.shares * 3 + m.saves * 2;
  const er = m.engagementRate > 0 ? m.engagementRate * 1000 : 0;
  const reach = Math.log10(Math.max(1, m.impressions || m.views));
  return eng + er + reach * 10;
}

/** Rank recent organic winners that can be boosted (need Zernio external_post_id). */
export async function rankBoostCandidates(
  supabase: SupabaseClient,
  brandId: string,
  opts: { days?: number; limit?: number; minImpressions?: number } = {}
): Promise<BoostCandidate[]> {
  const days = opts.days ?? 30;
  const limit = opts.limit ?? 12;
  const minImpressions = opts.minImpressions ?? 50;
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const [{ data: history }, { data: posts }] = await Promise.all([
    supabase
      .from('social_post_history')
      .select('id, platform, content, published_at, platform_post_url, metrics, external_post_id, source, thumbnail_path')
      .eq('brand_id', brandId)
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(80),
    supabase
      .from('posts')
      .select('id, platform, caption, media_url, published_url, external_post_id, status, scheduled_for')
      .eq('brand_id', brandId)
      .in('status', ['published', 'scheduled'])
      .not('external_post_id', 'is', null)
      .order('scheduled_for', { ascending: false })
      .limit(80)
  ]);

  // Index Anomalia posts by Zernio external id for caption/media join.
  const byExternal = new Map<string, (typeof posts extends (infer T)[] | null ? T : never)>();
  for (const p of posts ?? []) {
    if (p.external_post_id) byExternal.set(p.external_post_id, p);
  }

  // Already-proposed/active campaigns for these posts — skip duplicates.
  const { data: existing } = await supabase
    .from('ad_campaigns')
    .select('post_id, status')
    .eq('brand_id', brandId)
    .in('status', ['proposed', 'approved', 'active', 'pending_review']);
  const busyPosts = new Set((existing ?? []).map((c) => c.post_id).filter(Boolean));

  const out: BoostCandidate[] = [];

  // Prefer Anomalia-published posts (have external_post_id we can boost).
  for (const p of posts ?? []) {
    const plat = (p.platform ?? '').toLowerCase();
    if (!BOOSTABLE_PLATFORMS.has(plat)) continue;
    if (!p.external_post_id) continue;
    if (busyPosts.has(p.id)) continue;

    // Pull metrics from history if we have a matching Zernio sync row.
    const hist = (history ?? []).find(
      (h) => h.external_post_id === p.external_post_id || (h.source === 'zernio' && h.external_post_id === p.external_post_id)
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (hist?.metrics ?? {}) as any;
    const metrics = {
      likes: Number(raw.likes) || 0,
      comments: Number(raw.comments) || 0,
      shares: Number(raw.shares) || 0,
      saves: Number(raw.saves) || 0,
      impressions: Number(raw.impressions) || 0,
      views: Number(raw.views) || 0,
      engagementRate: Number(raw.engagementRate) || 0
    };
    if (metrics.impressions + metrics.views > 0 && metrics.impressions + metrics.views < minImpressions) {
      continue;
    }
    const score = engagementScore(metrics);
    out.push({
      postId: p.id,
      historyId: hist?.id ?? null,
      externalPostId: p.external_post_id,
      platform: plat,
      caption: p.caption,
      mediaUrl: p.media_url,
      publishedAt: p.scheduled_for,
      url: p.published_url,
      score,
      metrics,
      reason:
        metrics.engagementRate > 0
          ? `Engagement rate ${(metrics.engagementRate * 100).toFixed(1)}% · ${metrics.likes + metrics.comments} interactions`
          : `Published on ${plat} — ready to amplify`
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function defaultGoal(platform: string): AdGoal {
  // Google create supports engagement/traffic/awareness/video_views only.
  if (toAdsPlatform(platform) === 'googleads') return 'traffic';
  return 'engagement';
}

function defaultBudget(settings: AdsSettings): { amount: number; type: 'daily'; currency?: string } {
  const cap = settings.dailyBudgetCap ?? 25;
  const amount = Math.min(25, Math.max(5, Math.floor(cap / 2) || 10));
  return { amount, type: 'daily', currency: settings.defaultCurrency };
}

/**
 * AI-style budget recommendation from brand caps + organic engagement.
 * Higher engagement → slightly higher daily budget (still within the daily cap).
 */
export function recommendBoostBudget(
  settings: AdsSettings,
  metrics?: {
    likes?: number;
    comments?: number;
    shares?: number;
    impressions?: number;
    views?: number;
    engagementRate?: number;
  } | null
): { amount: number; type: 'daily'; currency?: string; reason: string } {
  const base = defaultBudget(settings);
  const cap = settings.dailyBudgetCap ?? 50;
  const m = metrics ?? {};
  const eng = (m.likes ?? 0) + (m.comments ?? 0) * 2 + (m.shares ?? 0) * 3;
  const reach = Math.log10(Math.max(1, m.impressions || m.views || 0));
  const er = (m.engagementRate ?? 0) > 0.02 ? 1 : (m.engagementRate ?? 0) > 0.01 ? 0.5 : 0;
  const boost = Math.min(15, Math.floor(eng / 40) + Math.floor(reach) + Math.floor(er * 5));
  const amount = Math.min(cap, Math.max(5, base.amount + boost));
  const reason =
    amount > base.amount
      ? `Raised from €${base.amount}/day baseline — strong organic signals (engagement ${eng}, reach ${Math.round(m.impressions || m.views || 0)}).`
      : `Baseline €${amount}/day from your daily cap (€${cap}).`;
  return { amount, type: 'daily', currency: base.currency, reason };
}

function defaultTargeting(settings: AdsSettings): AdTargeting {
  return {
    age_min: 25,
    age_max: 55,
    countries: settings.defaultCountries?.length ? settings.defaultCountries : ['IT']
  };
}

/** Create AI boost proposals (status=proposed) — does NOT spend. */
export async function proposeBoosts(
  supabase: SupabaseClient,
  brand: { id: string; plan: string | null; ads_settings?: unknown; actorEmail?: string | null },
  opts: { limit?: number } = {}
): Promise<{ created: number; candidates: number }> {
  if (!adsAvailable(brand.plan, brand.actorEmail)) return { created: 0, candidates: 0 };
  const settings = parseAdsSettings(brand.ads_settings);
  const candidates = await rankBoostCandidates(supabase, brand.id, { limit: opts.limit ?? 5 });

  const { data: adAccounts } = await supabase
    .from('zernio_ad_accounts')
    .select('id, platform, zernio_ad_account_id')
    .eq('brand_id', brand.id)
    .eq('status', 'active');

  let created = 0;
  for (const c of candidates) {
    const adsPlat = toAdsPlatform(c.platform);
    const account =
      (adAccounts ?? []).find((a) => toAdsPlatform(a.platform) === adsPlat) ??
      (adsPlat === 'metaads'
        ? (adAccounts ?? []).find((a) => ['metaads', 'facebook', 'instagram'].includes(a.platform))
        : undefined);
    if (!account) continue;

    const budget = defaultBudget(settings);
    const targeting = defaultTargeting(settings);
    const goal = defaultGoal(c.platform);
    const name = `Boost · ${(c.caption ?? c.platform).slice(0, 40)}`.trim();

    const { error } = await supabase.from('ad_campaigns').insert({
      brand_id: brand.id,
      post_id: c.postId,
      ad_account_id: account.id,
      platform: adsPlat,
      ad_type: 'boost',
      name,
      goal,
      budget_amount: budget.amount,
      budget_type: budget.type,
      currency: budget.currency ?? settings.defaultCurrency ?? 'EUR',
      status: 'proposed',
      targeting,
      proposed_by: 'ai',
      proposal_reason: c.reason,
      external_ids: { zernioPostId: c.externalPostId, socialPlatform: c.platform }
    });
    if (!error) created++;
  }
  return { created, candidates: candidates.length };
}

/** Propose a boost for one published post (status=proposed) — does NOT spend. */
export async function proposeBoostForPost(
  supabase: SupabaseClient,
  brand: { id: string; plan: string | null; ads_settings?: unknown; actorEmail?: string | null },
  postId: string,
  opts: { budgetAmount?: number } = {}
): Promise<{ ok: true; campaignId: string } | { ok: false; error: string }> {
  if (!adsAvailable(brand.plan, brand.actorEmail)) return { ok: false, error: 'ads_not_on_plan' };

  const { data: post } = await supabase
    .from('posts')
    .select('id, platform, platforms, caption, media_url, status, external_post_id, published_url')
    .eq('id', postId)
    .eq('brand_id', brand.id)
    .maybeSingle();

  if (!post) return { ok: false, error: 'post_not_found' };
  if (post.status !== 'published' || !post.external_post_id) {
    return { ok: false, error: 'post_not_boostable' };
  }

  const platform = (post.platform ?? '').toLowerCase();
  if (!BOOSTABLE_PLATFORMS.has(platform)) {
    return { ok: false, error: `platform_not_boostable:${platform || 'unknown'}` };
  }

  const { data: existing } = await supabase
    .from('ad_campaigns')
    .select('id, status')
    .eq('brand_id', brand.id)
    .eq('post_id', postId)
    .in('status', ['proposed', 'approved', 'active', 'pending_review'])
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: false, error: `already_${existing.status}` };

  const adsPlat = toAdsPlatform(platform);
  const { data: adAccounts } = await supabase
    .from('zernio_ad_accounts')
    .select('id, platform, zernio_ad_account_id')
    .eq('brand_id', brand.id)
    .eq('status', 'active');

  const account =
    (adAccounts ?? []).find((a) => toAdsPlatform(a.platform) === adsPlat) ??
    (adsPlat === 'metaads'
      ? (adAccounts ?? []).find((a) => ['metaads', 'facebook', 'instagram'].includes(a.platform))
      : undefined);
  if (!account) return { ok: false, error: 'ad_account_missing' };

  const settings = parseAdsSettings(brand.ads_settings);

  let metrics: BoostCandidate['metrics'] | null = null;
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
      saves: Number(m.saves) || 0,
      impressions: Number(m.impressions) || 0,
      views: Number(m.views) || 0,
      engagementRate: Number(m.engagementRate) || 0
    };
  }

  const recommended = recommendBoostBudget(settings, metrics);
  const amount =
    opts.budgetAmount != null && Number.isFinite(opts.budgetAmount) && opts.budgetAmount > 0
      ? Math.floor(opts.budgetAmount)
      : recommended.amount;
  const fee = feeBreakdown(amount);
  const targeting = defaultTargeting(settings);
  const goal = defaultGoal(platform);
  const name = `Boost · ${(post.caption ?? platform).slice(0, 40)}`.trim();

  const { data: inserted, error } = await supabase
    .from('ad_campaigns')
    .insert({
      brand_id: brand.id,
      post_id: post.id,
      ad_account_id: account.id,
      platform: adsPlat,
      ad_type: 'boost',
      name,
      goal,
      budget_amount: amount,
      budget_type: 'daily',
      currency: recommended.currency ?? settings.defaultCurrency ?? 'EUR',
      status: 'proposed',
      targeting,
      proposed_by: 'ai',
      proposal_reason: recommended.reason,
      external_ids: {
        zernioPostId: post.external_post_id,
        socialPlatform: platform,
        feeRate: fee.feeRate,
        feeAmount: fee.fee,
        platformBudget: fee.platformBudget
      }
    })
    .select('id')
    .maybeSingle();

  if (error || !inserted) return { ok: false, error: error?.message ?? 'insert_failed' };
  return { ok: true, campaignId: inserted.id };
}

async function assertBudgetCaps(
  supabase: SupabaseClient,
  brandId: string,
  settings: AdsSettings,
  dailyAmount: number
): Promise<string | null> {
  if (settings.dailyBudgetCap && dailyAmount > settings.dailyBudgetCap) {
    return `Budget ${dailyAmount} exceeds daily cap ${settings.dailyBudgetCap}`;
  }
  if (settings.monthlyBudgetCap) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { data: rows } = await supabase
      .from('ad_metrics')
      .select('campaign_id, spend, period_end')
      .eq('brand_id', brandId)
      .gte('period_start', monthStart.toISOString().slice(0, 10));
    // Each row is a CUMULATIVE snapshot of a campaign's spend, and the sync writes a fresh row
    // every day (period_start/period_end move), so summing them counted the same euros once per
    // sync — a €25/day campaign read as thousands after a week and blocked every approval. Take
    // the latest snapshot per campaign instead, which is the actual spend to date.
    const latest = new Map<string, { spend: number; periodEnd: string }>();
    for (const r of rows ?? []) {
      const key = String(r.campaign_id);
      const periodEnd = String(r.period_end ?? '');
      const prev = latest.get(key);
      if (!prev || periodEnd >= prev.periodEnd) latest.set(key, { spend: Number(r.spend || 0), periodEnd });
    }
    const spent = [...latest.values()].reduce((s, r) => s + r.spend, 0);
    // Also count active campaign daily budgets * remaining days as soft warning — hard block on metrics only.
    if (spent + dailyAmount > settings.monthlyBudgetCap) {
      return `Monthly spend ${spent.toFixed(0)} + ${dailyAmount} would exceed cap ${settings.monthlyBudgetCap}`;
    }
  }
  return null;
}

/** User approves a proposed campaign → call Zernio boost/create and activate. */
/**
 * The campaign's creative as stored: the primary ad, plus the extra ads that share its ad set.
 * Kept INSIDE the existing `creative` jsonb on purpose — a new column would need a migration, and
 * deploys here do not run them, so the column would be missing in production on first read.
 */
export type CreativeWithVariants = NonNullable<CreateStandaloneAdInput['creative']> & {
  variants?: AdCreativeVariant[];
};

/** Stable short digest of a request body. Not security — just an idempotency-key discriminator. */
function shortDigest(value: unknown): string {
  const s = JSON.stringify(value) ?? '';
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function approveCampaign(
  supabase: SupabaseClient,
  brand: {
    id: string;
    plan: string | null;
    zernio_profile_id: string | null;
    ads_settings?: unknown;
    activated_at?: string | null;
    status?: string;
    actorEmail?: string | null;
  },
  campaignId: string,
  overrides?: {
    budgetAmount?: number;
    budgetType?: 'daily' | 'lifetime';
    goal?: AdGoal;
    targeting?: AdTargeting;
  }
): Promise<{ ok: true; zernioAdId: string } | { ok: false; error: string }> {
  if (!adsAvailable(brand.plan, brand.actorEmail)) return { ok: false, error: 'ads_not_on_plan' };
  if (!brand.zernio_profile_id) return { ok: false, error: 'zernio_profile_missing' };

  // Self-heal a row stranded by a crash between the claim below and the platform's answer. The
  // create call cannot take ten minutes, so anything older than that is not in flight — without
  // this the campaign would sit in 'launching' forever with no way for the user to retry.
  await supabase
    .from('ad_campaigns')
    .update({ status: 'failed', error: 'launch_interrupted', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('brand_id', brand.id)
    .eq('status', 'launching')
    .lt('updated_at', new Date(Date.now() - 10 * 60_000).toISOString());

  const { data: campaign } = await supabase
    .from('ad_campaigns')
    .select('*, zernio_ad_accounts(*), posts(id, external_post_id, platform, media_url, caption)')
    .eq('id', campaignId)
    .eq('brand_id', brand.id)
    .maybeSingle();

  if (!campaign) return { ok: false, error: 'not_found' };
  if (!['proposed', 'failed'].includes(campaign.status)) {
    return { ok: false, error: `invalid_status:${campaign.status}` };
  }

  const settings = parseAdsSettings(brand.ads_settings);
  const budgetAmount = overrides?.budgetAmount ?? Number(campaign.budget_amount);
  const budgetType = overrides?.budgetType ?? (campaign.budget_type as 'daily' | 'lifetime');
  const goal = (overrides?.goal ?? campaign.goal) as AdGoal;
  const targeting = overrides?.targeting ?? (campaign.targeting as AdTargeting);

  const capErr = await assertBudgetCaps(supabase, brand.id, settings, budgetAmount);
  if (capErr) return { ok: false, error: capErr };

  // Launching bills the management fee on the first day of budget up front. Checked BEFORE the
  // platform call: once Meta/Google has the campaign, the money is committed whether we can bill
  // for it or not.
  const launchCredits = creditsForSpend(budgetAmount);
  const afford = await canAffordAdsCredits(supabase, brand, launchCredits);
  if (!afford.ok) {
    return { ok: false, error: `credits_exhausted:${launchCredits}:${afford.usage.remaining}` };
  }

  const adAccount = campaign.zernio_ad_accounts as {
    id: string;
    zernio_ad_account_id: string;
    zernio_social_account_id: string | null;
    platform: string;
  } | null;
  if (!adAccount) return { ok: false, error: 'ad_account_missing' };

  // Resolve social accountId for Zernio (required on boost/create).
  let socialAccountId = adAccount.zernio_social_account_id;
  if (!socialAccountId) {
    const plat = (campaign.external_ids as { socialPlatform?: string } | null)?.socialPlatform;
    const { data: sa } = await supabase
      .from('social_accounts')
      .select('zernio_account_id, platform')
      .eq('brand_id', brand.id)
      .eq('status', 'active');
    const match =
      (sa ?? []).find((a) => toAdsPlatform(a.platform ?? '') === toAdsPlatform(adAccount.platform)) ??
      (plat ? (sa ?? []).find((a) => a.platform === plat) : undefined) ??
      (sa ?? [])[0];
    socialAccountId = match?.zernio_account_id ?? null;
  }
  if (!socialAccountId) return { ok: false, error: 'social_account_missing' };

  // Claim the row before spending anything. The status check above is a read, so two clicks (or a
  // click plus a retry) both saw 'proposed' and both ran chargeAdsCredits — the platform call was
  // idempotent, the ledger was not, and the user paid the launch fee twice. This update is atomic:
  // only one caller can move the row out of proposed/failed, and the loser stops here.
  const { data: claimed } = await supabase
    .from('ad_campaigns')
    .update({ status: 'launching', updated_at: new Date().toISOString() })
    .eq('id', campaign.id)
    .eq('brand_id', brand.id)
    .in('status', ['proposed', 'failed'])
    .select('id')
    .maybeSingle();
  if (!claimed) return { ok: false, error: 'already_launching' };

  // Zernio replays a key verbatim and rejects the SAME key with a different body (422). Approving,
  // failing, editing the budget and approving again is a different body — so the key carries a
  // digest of what we are about to send. Same request retried = replayed; edited = fresh key.
  const idempotencyKey = `anomalia-ad-${campaign.id}-${shortDigest({
    budgetAmount,
    budgetType,
    goal,
    targeting,
    creative: campaign.creative
  })}`;

  try {
    let ad: ZernioAd;
    // Every ad this campaign owns, primary first. One entry unless the multi-creative shape ran.
    let siblingAds: ZernioAd[] = [];
    if (campaign.ad_type === 'duplicate') {
      // The copy already exists on the platform — Zernio creates duplicates PAUSED, so approving
      // means RESUMING it, not creating it again. external_ids holds the copy's campaign + ads.
      const stored = (campaign.external_ids ?? {}) as {
        platformCampaignId?: string;
        ads?: { id: string; name?: string | null; platformAdId?: string | null }[];
      };
      const zernioPlatform = toZernioPlatform(campaign.platform);
      if (!stored.platformCampaignId || !zernioPlatform) throw new Error('duplicate_platform_missing');
      await updateCampaignStatus(stored.platformCampaignId, 'active', zernioPlatform);
      siblingAds = (stored.ads ?? []).map((a) => ({
        id: a.id,
        name: a.name ?? null,
        platform: campaign.platform,
        status: 'active',
        reviewStatus: null,
        adType: null,
        goal,
        budget: null,
        metrics: null,
        platformAdId: a.platformAdId ?? null,
        platformCampaignId: stored.platformCampaignId!,
        platformAdSetId: null,
        platformAdAccountId: null
      }));
      if (!siblingAds.length) throw new Error('duplicate_ads_missing');
      ad = siblingAds[0];
    } else if (campaign.ad_type === 'standalone') {
      const stored = (campaign.creative ?? {}) as CreativeWithVariants;
      const { variants, ...creative } = stored;
      // Google already does multivariate inside ONE ad (headlines[]/descriptions[] recombined by
      // the platform), so variants only become separate ads on Meta.
      const creatives =
        toAdsPlatform(campaign.platform) !== 'googleads' && variants?.length
          ? [{ ...creative, name: campaign.name }, ...variants]
          : undefined;
      const created = await createStandaloneAd(
        {
          accountId: socialAccountId,
          adAccountId: adAccount.zernio_ad_account_id,
          name: campaign.name,
          goal,
          budget: { amount: budgetAmount, type: budgetType, currency: campaign.currency ?? undefined },
          platform: campaign.platform,
          campaignType: (campaign.external_ids as { campaignType?: 'SEARCH' | 'DISPLAY' } | null)
            ?.campaignType,
          targeting,
          creative,
          creatives,
          schedule: (campaign.schedule as { startDate?: string; endDate?: string }) ?? undefined,
          dsaBeneficiary: settings.dsaBeneficiary,
          dsaPayor: settings.dsaPayor
        },
        idempotencyKey
      );
      siblingAds = created.ads;
      ad = created.ads[0];
    } else {
      const zernioPostId =
        (campaign.external_ids as { zernioPostId?: string } | null)?.zernioPostId ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (campaign.posts as any)?.external_post_id;
      // Thrown, not returned: the row is already claimed as 'launching', and the catch below is
      // what puts it back to 'failed'. A bare return would strand it.
      if (!zernioPostId) throw new Error('zernio_post_id_missing');

      ad = await boostPost(
        {
          postId: zernioPostId,
          accountId: socialAccountId,
          adAccountId: adAccount.zernio_ad_account_id,
          name: campaign.name,
          goal,
          budget: { amount: budgetAmount, type: budgetType, currency: campaign.currency ?? undefined },
          targeting,
          platform: campaign.platform,
          schedule: (campaign.schedule as { startDate?: string; endDate?: string }) ?? undefined,
          dsaBeneficiary: settings.dsaBeneficiary,
          dsaPayor: settings.dsaPayor
        },
        idempotencyKey
      );
      siblingAds = [ad];
    }

    const status =
      ad.reviewStatus && /review|pending/i.test(ad.reviewStatus) ? 'pending_review' : 'active';

    const fee = feeBreakdown(budgetAmount);

    // Day 1 is pre-paid: seed creditedSpend with the budget we just billed so the daily
    // reconciliation only charges spend beyond it.
    chargeAdsCredits({
      brandId: brand.id,
      credits: launchCredits,
      label: 'ads.launch',
      campaignId: campaign.id,
      platform: campaign.platform
    });

    await supabase
      .from('ad_campaigns')
      .update({
        status,
        review_status: ad.reviewStatus,
        zernio_ad_id: ad.id,
        budget_amount: budgetAmount,
        budget_type: budgetType,
        goal,
        targeting,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: null,
        external_ids: {
          ...(typeof campaign.external_ids === 'object' && campaign.external_ids
            ? campaign.external_ids
            : {}),
          platformAdId: ad.platformAdId,
          platformCampaignId: ad.platformCampaignId,
          platformAdSetId: ad.platformAdSetId,
          // Every ad under this campaign, so pausing and metrics reach all of them and not just
          // the primary. `zernio_ad_id` stays the primary for everything that predates variants.
          ads: siblingAds.map((a) => ({
            id: a.id,
            name: a.name,
            platformAdId: a.platformAdId,
            status: 'active' as const
          })),
          feeRate: fee.feeRate,
          feeAmount: fee.fee,
          platformBudget: fee.platformBudget,
          creditedSpend: budgetAmount,
          launchCredits
        }
      })
      .eq('id', campaign.id);

    return { ok: true, zernioAdId: ad.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from('ad_campaigns')
      .update({ status: 'failed', error: msg.slice(0, 2000), updated_at: new Date().toISOString() })
      .eq('id', campaign.id);
    return { ok: false, error: msg };
  }
}

export async function rejectCampaign(
  supabase: SupabaseClient,
  brandId: string,
  campaignId: string
): Promise<void> {
  await supabase
    .from('ad_campaigns')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('brand_id', brandId)
    .eq('status', 'proposed');
}

/**
 * Duplicate a live campaign. The copy exists on the platform already (created PAUSED by Zernio,
 * safe default) — this only creates the proposed row the user approves later. Approving a
 * duplicate RESUMES the copy instead of creating it again.
 */
export async function duplicateCampaign(
  supabase: SupabaseClient,
  brandId: string,
  campaignId: string
): Promise<{ ok: true; id: string; copiedCampaignId: string } | { ok: false; error: string }> {
  const { data: campaign } = await supabase
    .from('ad_campaigns')
    .select('*, zernio_ad_accounts(id, zernio_ad_account_id)')
    .eq('id', campaignId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!campaign) return { ok: false, error: 'not_found' };
  if (!['active', 'paused', 'pending_review', 'completed'].includes(campaign.status)) {
    return { ok: false, error: `invalid_status:${campaign.status}` };
  }
  const platformCampaignId = (campaign.external_ids as { platformCampaignId?: string } | null)
    ?.platformCampaignId;
  if (!platformCampaignId) return { ok: false, error: 'not_live' };
  const zernioPlatform = toZernioPlatform(campaign.platform);
  if (!zernioPlatform) return { ok: false, error: `unsupported_platform:${campaign.platform}` };

  try {
    const { copiedCampaignId } = await zernioDuplicateCampaign({
      platformCampaignId,
      platform: zernioPlatform
    });

    // The copy is a paused shell until discovery runs — pull its ads now so pausing/resuming the
    // proposed row works against real ad ids and not just the campaign id.
    const adAccount = campaign.zernio_ad_accounts as { id: string; zernio_ad_account_id: string } | null;
    const copyAds = adAccount
      ? (await listAds({ adAccountId: adAccount.zernio_ad_account_id, limit: 100 }).catch((error) => { swallow('list platform ads', error); return []; }))
          .filter((a) => a.platformCampaignId === copiedCampaignId)
          .map((a) => ({
            id: a.id,
            name: a.name,
            platformAdId: a.platformAdId,
            status: 'paused' as const
          }))
      : [];

    const { data: inserted, error } = await supabase
      .from('ad_campaigns')
      .insert({
        brand_id: brandId,
        ad_account_id: campaign.ad_account_id,
        post_id: campaign.post_id,
        zernio_ad_id: copyAds[0]?.id ?? null,
        platform: campaign.platform,
        ad_type: 'duplicate',
        name: `${campaign.name} (copy)`,
        goal: campaign.goal,
        budget_amount: campaign.budget_amount,
        budget_type: campaign.budget_type,
        currency: campaign.currency,
        status: 'proposed',
        targeting: campaign.targeting,
        creative: campaign.creative,
        schedule: campaign.schedule,
        proposed_by: 'user',
        proposal_reason: `duplicated from ${campaign.id}`,
        external_ids: {
          platformCampaignId: copiedCampaignId,
          copiedFromCampaignId: campaign.id,
          ads: copyAds
        }
      })
      .select('id')
      .maybeSingle();
    if (error || !inserted) return { ok: false, error: error?.message ?? 'insert_failed' };
    return { ok: true, id: inserted.id, copiedCampaignId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Delete a campaign on the platform and mark it cancelled locally (kept for history, like Zernio
 * keeps its Ad docs). Meta campaigns go through the cascade DELETE; other platforms 501 there, so
 * fall back to cancelling each ad — which Zernio supports everywhere.
 */
export async function deleteCampaign(
  supabase: SupabaseClient,
  brandId: string,
  campaignId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: campaign } = await supabase
    .from('ad_campaigns')
    .select('id, zernio_ad_id, status, platform, external_ids')
    .eq('id', campaignId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!campaign) return { ok: false, error: 'not_found' };
  if (['proposed', 'rejected', 'cancelled'].includes(campaign.status)) {
    return { ok: false, error: `invalid_status:${campaign.status}` };
  }

  const platformCampaignId = (campaign.external_ids as { platformCampaignId?: string } | null)
    ?.platformCampaignId;
  const zernioPlatform = toZernioPlatform(campaign.platform);

  try {
    if (
      platformCampaignId &&
      (zernioPlatform === 'facebook' || zernioPlatform === 'instagram')
    ) {
      await zernioDeleteCampaign(platformCampaignId, zernioPlatform);
    } else {
      const refs = campaignAdRefs(campaign);
      if (!refs.length) return { ok: false, error: 'not_live' };
      for (const ref of refs) await zernioDeleteAd(ref.id);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  await supabase
    .from('ad_campaigns')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('brand_id', brandId);
  return { ok: true };
}

/** The ads a campaign owns, as stored on external_ids. Falls back to the pre-variants single id. */
type CampaignAdRef = { id: string; name?: string | null; platformAdId?: string | null; status?: string };
export function campaignAdRefs(campaign: {
  zernio_ad_id: string | null;
  external_ids: unknown;
}): CampaignAdRef[] {
  const stored = (campaign.external_ids as { ads?: CampaignAdRef[] } | null)?.ads;
  if (Array.isArray(stored) && stored.length) return stored.filter((a) => a?.id);
  return campaign.zernio_ad_id ? [{ id: campaign.zernio_ad_id, status: 'active' }] : [];
}

/**
 * Flip a whole campaign on or off. Hits EVERY ad it owns: a multi-creative campaign is N ads in
 * one ad set, and pausing only the primary would leave the rest live and spending.
 */
/**
 * Turning spend back on has to pass the same gate that turned it off. The credits-exhausted
 * auto-pause is only a safety net if it cannot be undone by a switch that asks nothing: without
 * this the campaign resumed spending on Meta while the balance was zero, and the next tick paused
 * it again.
 */
async function assertCanResume(
  supabase: SupabaseClient,
  brandId: string,
  budgetAmount: number
): Promise<string | null> {
  const { data: brand } = await supabase
    .from('brands')
    .select('id, plan, status, activated_at')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand) return 'not_found';
  const needed = creditsForSpend(budgetAmount);
  const afford = await canAffordAdsCredits(supabase, brand, needed);
  return afford.ok ? null : `credits_exhausted:${needed}:${afford.usage.remaining}`;
}

export async function setCampaignStatus(
  supabase: SupabaseClient,
  brandId: string,
  campaignId: string,
  next: 'active' | 'paused'
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: c } = await supabase
    .from('ad_campaigns')
    .select('id, zernio_ad_id, status, external_ids, budget_amount')
    .eq('id', campaignId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!c) return { ok: false, error: 'not_found' };

  if (next === 'active') {
    const blocked = await assertCanResume(supabase, brandId, Number(c.budget_amount));
    if (blocked) return { ok: false, error: blocked };
  }

  const refs = campaignAdRefs(c);
  if (!refs.length) return { ok: false, error: 'not_live' };

  // Lowercase: that is the enum PUT /ads/{adId} accepts (create is the one that takes uppercase).
  const platformStatus = next === 'paused' ? 'paused' : 'active';
  const failures: string[] = [];
  const updated: CampaignAdRef[] = [];
  for (const ref of refs) {
    try {
      await updateAd(ref.id, { status: platformStatus });
      updated.push({ ...ref, status: next });
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
      updated.push(ref);
    }
  }
  // A partial failure is NOT a pause: report it, and keep per-ad state honest so the UI shows
  // which ones are still live rather than a campaign that looks stopped while it spends.
  await supabase
    .from('ad_campaigns')
    .update({
      status: failures.length ? c.status : next,
      external_ids: { ...(typeof c.external_ids === 'object' && c.external_ids ? c.external_ids : {}), ads: updated },
      updated_at: new Date().toISOString()
    })
    .eq('id', c.id);

  return failures.length ? { ok: false, error: failures[0] } : { ok: true };
}

/** Flip ONE ad of a campaign. The others keep running — that is the point of an A/B. */
export async function setCreativeStatus(
  supabase: SupabaseClient,
  brandId: string,
  campaignId: string,
  adId: string,
  next: 'active' | 'paused'
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: c } = await supabase
    .from('ad_campaigns')
    .select('id, zernio_ad_id, status, external_ids, budget_amount')
    .eq('id', campaignId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!c) return { ok: false, error: 'not_found' };

  const refs = campaignAdRefs(c);
  if (!refs.some((a) => a.id === adId)) return { ok: false, error: 'ad_not_in_campaign' };

  // Same gate as the campaign switch: one creative back on is still spend back on.
  if (next === 'active') {
    const blocked = await assertCanResume(supabase, brandId, Number(c.budget_amount));
    if (blocked) return { ok: false, error: blocked };
  }

  try {
    await updateAd(adId, { status: next === 'paused' ? 'paused' : 'active' });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const updated = refs.map((a) => (a.id === adId ? { ...a, status: next } : a));
  // Pausing the last live ad stops the campaign; re-enabling any ad revives it.
  const anyLive = updated.some((a) => a.status !== 'paused');
  await supabase
    .from('ad_campaigns')
    .update({
      status: anyLive ? (c.status === 'paused' ? 'active' : c.status) : 'paused',
      external_ids: { ...(typeof c.external_ids === 'object' && c.external_ids ? c.external_ids : {}), ads: updated },
      updated_at: new Date().toISOString()
    })
    .eq('id', c.id);

  return { ok: true };
}

/** Back-compat wrapper — every existing caller only ever pauses. */
export async function pauseCampaign(
  supabase: SupabaseClient,
  brandId: string,
  campaignId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return setCampaignStatus(supabase, brandId, campaignId, 'paused');
}

/** Discover + upsert Zernio ad accounts for a brand profile. */
export async function syncAdAccounts(
  supabase: SupabaseClient,
  brand: { id: string; zernio_profile_id: string | null }
): Promise<number> {
  // No flag re-check here: every caller already gated on adsAvailable/adsFeatureEnabled WITH the
  // user's email, and the email-less check silently returned 0 for preview users while
  // FEATURE_ADS is off — the connect flow appeared to succeed but no account ever landed.
  if (!brand.zernio_profile_id) return 0;

  const { data: socials } = await supabase
    .from('social_accounts')
    .select('id, zernio_account_id, platform')
    .eq('brand_id', brand.id)
    .eq('status', 'active');

  // Zernio's /ads/accounts REQUIRES accountId — passing only profileId 400s. And the ads-only
  // Facebook connection never lands in social_accounts (it is not a publishing slot), so walk the
  // profile's accounts on ZERNIO's side, not ours, and ask each one for its ad accounts.
  const zernioAccounts = await publisher.accounts(brand.zernio_profile_id).catch((error) => { swallow('list profile accounts', error); return []; });
  const accounts: ZernioAdAccount[] = [];
  for (const za of zernioAccounts) {
    const accountId = String(za.id);
    if (!accountId) continue;
    try {
      for (const m of await listAdAccounts({ accountId })) {
        if (accounts.some((a) => a.id === m.id)) continue;
        // An ad account carries no platform/owner of its own — inherit both from the Zernio
        // account it was listed under, which is what decides metaads vs googleads downstream.
        accounts.push({
          ...m,
          platform: m.platform ?? za.platform ?? null,
          socialAccountId: m.socialAccountId ?? accountId
        });
      }
    } catch (error) { swallow('fetch zernio ad account metrics', error); }
  }

  let n = 0;
  for (const a of accounts) {
    const social = (socials ?? []).find(
      (s) =>
        s.zernio_account_id === a.socialAccountId ||
        toAdsPlatform(s.platform ?? '') === toAdsPlatform(a.platform ?? '')
    );
    const { error } = await supabase.from('zernio_ad_accounts').upsert(
      {
        brand_id: brand.id,
        social_account_id: social?.id ?? null,
        zernio_ad_account_id: a.platformAdAccountId ?? a.id,
        zernio_social_account_id: a.socialAccountId,
        platform: toAdsPlatform(a.platform ?? 'metaads'),
        name: a.name,
        currency: a.currency,
        status: a.status === 'inactive' ? 'inactive' : 'active',
        unusable_reason: a.unusableReason ?? null
      },
      { onConflict: 'brand_id,zernio_ad_account_id' }
    );
    if (!error) n++;
  }

  return n;
}

/**
 * Pull analytics for live campaigns into ad_metrics — and bill the management fee on whatever the
 * platform spent since the last sync. Delta-based, so calling it twice charges once.
 */
export async function syncAdMetrics(
  supabase: SupabaseClient,
  brandId: string
): Promise<number> {
  if (!adsFeatureEnabled()) return 0;
  const { data: campaigns } = await supabase
    .from('ad_campaigns')
    .select('id, zernio_ad_id, ad_account_id, status, platform, external_ids, approved_at, created_at')
    .eq('brand_id', brandId)
    .not('zernio_ad_id', 'is', null)
    .in('status', ['active', 'pending_review', 'paused']);

  let n = 0;
  const today = new Date().toISOString().slice(0, 10);
  // Each campaign is measured over ITS OWN lifetime, not a rolling 7-day label on a 90-day figure.
  // Zernio caps a range at 730 days, so clamp: an ancient campaign asks for the maximum instead
  // of erroring out.
  const maxRange = new Date(Date.now() - 720 * 86400_000).toISOString().slice(0, 10);
  const lifetimeStart = (c: { approved_at?: string | null; created_at?: string | null }) => {
    const started = String(c.approved_at ?? c.created_at ?? '').slice(0, 10);
    return started && started > maxRange ? started : maxRange;
  };

  for (const c of campaigns ?? []) {
    if (!c.zernio_ad_id) continue;
    try {
      const live = await getAd(c.zernio_ad_id);
      if (live?.status) {
        const mapped = /pause/i.test(live.status)
          ? 'paused'
          : /review|pending/i.test(live.reviewStatus ?? '')
            ? 'pending_review'
            : /active|ACTIVE/i.test(live.status)
              ? 'active'
              : c.status;
        await supabase
          .from('ad_campaigns')
          .update({
            status: mapped,
            review_status: live.reviewStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', c.id);
      }

      const from = lifetimeStart(c);
      const analytics = await getAdAnalytics(c.zernio_ad_id, { fromDate: from, toDate: today });
      const { error } = await supabase.from('ad_metrics').upsert(
        {
          brand_id: brandId,
          campaign_id: c.id,
          zernio_ad_account_id: c.ad_account_id,
          period_start: from,
          period_end: today,
          spend: analytics.spend,
          impressions: analytics.impressions,
          reach: analytics.reach,
          clicks: analytics.clicks,
          ctr: analytics.ctr,
          cpc: analytics.cpc,
          cpm: analytics.cpm,
          conversions: analytics.conversions,
          roas: analytics.roas,
          raw: analytics.raw,
          synced_at: new Date().toISOString()
        },
        { onConflict: 'campaign_id,period_start,period_end' }
      );
      if (!error) n++;

      // Bill the fee on new spend. The write of creditedSpend and the ledger row are not atomic;
      // if the update fails we simply re-charge the same delta next sync, so the update goes first
      // and the charge only happens once it stuck (under-billing beats double-billing).
      const due = creditsDue(analytics.spend, creditedSpend(c.external_ids));
      if (due > 0) {
        const { error: markErr } = await supabase
          .from('ad_campaigns')
          .update({
            external_ids: {
              ...(typeof c.external_ids === 'object' && c.external_ids ? c.external_ids : {}),
              creditedSpend: analytics.spend
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', c.id);
        if (!markErr) {
          chargeAdsCredits({
            brandId,
            credits: due,
            label: 'ads.spend',
            campaignId: c.id,
            platform: c.platform
          });
        }
      }
    } catch (e) {
      console.warn('[ads] metrics sync failed for', c.id, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

/** Propose a standalone Meta/Google/TikTok/… campaign (status=proposed). */
export async function proposeStandalone(
  supabase: SupabaseClient,
  brand: { id: string; plan: string | null; ads_settings?: unknown; actorEmail?: string | null },
  input: {
    platform: string;
    name: string;
    goal?: AdGoal;
    budgetAmount?: number;
    campaignType?: 'SEARCH' | 'DISPLAY';
    /** May carry `variants`: extra ads that will share this campaign's ad set. */
    creative: CreativeWithVariants;
    targeting?: AdTargeting;
    adAccountId?: string;
    /** endDate is what stops the daily budget from recurring forever. */
    schedule?: { startDate?: string; endDate?: string };
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!adsAvailable(brand.plan, brand.actorEmail)) return { ok: false, error: 'ads_not_on_plan' };
  const settings = parseAdsSettings(brand.ads_settings);
  const adsPlat = toAdsPlatform(input.platform);
  // Refuse a goal the platform will reject at launch. The form no longer offers these, but the
  // CLI and the v1 API take whatever the caller sends, and failing here costs nothing — failing at
  // approval costs the user a campaign they thought they had bought.
  if (input.goal && !SUPPORTED_GOALS.has(input.goal)) {
    return { ok: false, error: `goal_not_supported:${input.goal}` };
  }
  // Social channel is Meta-only; Google stays on its own channel.
  if (adsPlat !== 'googleads' && !(SOCIAL_ADS_PLATFORMS as readonly string[]).includes(adsPlat)) {
    return { ok: false, error: 'platform_not_supported' };
  }

  const { data: accounts } = await supabase
    .from('zernio_ad_accounts')
    .select('id, platform')
    .eq('brand_id', brand.id)
    .eq('status', 'active');

  const account =
    (input.adAccountId
      ? (accounts ?? []).find((a) => a.id === input.adAccountId)
      : undefined) ??
    (accounts ?? []).find((a) => toAdsPlatform(a.platform) === adsPlat);

  // No ad account yet? Save the proposal anyway. Drafting a campaign before the OAuth is done is
  // normal — the account is only REQUIRED to launch, and approveCampaign still refuses without one
  // (ad_account_missing), so nothing can go live unattached.

  const budget = input.budgetAmount ?? defaultBudget(settings).amount;
  const { data, error } = await supabase
    .from('ad_campaigns')
    .insert({
      brand_id: brand.id,
      ad_account_id: account?.id ?? null,
      platform: adsPlat,
      ad_type: 'standalone',
      name: input.name.slice(0, 255),
      goal: input.goal ?? defaultGoal(adsPlat),
      budget_amount: budget,
      budget_type: 'daily',
      currency: settings.defaultCurrency ?? 'EUR',
      status: 'proposed',
      // Merge, don't replace: a form that only supplies keywords must keep the brand's default
      // countries and age range, or the campaign silently goes worldwide.
      targeting: { ...defaultTargeting(settings), ...(input.targeting ?? {}) },
      // A daily budget with no end date bills every day until someone remembers to stop it. Null
      // stays possible — an always-on campaign is a real choice — but it has to be a choice.
      schedule: input.schedule?.endDate || input.schedule?.startDate ? input.schedule : null,
      creative: input.creative,
      proposed_by: 'user',
      proposal_reason: 'Standalone campaign',
      external_ids: input.campaignType ? { campaignType: input.campaignType } : {}
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'insert_failed' };
  return { ok: true, id: data.id };
}

// ── Readiness ───────────────────────────────────────────────────────────────────
// Everything that must be true before a channel can actually spend. The UI renders this as a
// checklist with a fix link per row instead of letting the user hit a 4xx from Meta/Google after
// approving a campaign.

export type AdsChannel = 'social' | 'google';

export type AdsCheck = {
  key: string;
  ok: boolean;
  /** A false blocking check makes the channel unlaunchable; non-blocking ones are warnings. */
  blocking: boolean;
  /** Relative href that fixes it, when there is one. */
  fix?: string;
  detail?: string;
};

/** EU targeting obliges Meta advertisers to declare DSA beneficiary + payor. */
const EU_COUNTRIES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT',
  'NL','PL','PT','RO','SK','SI','ES','SE'
]);

export async function adsReadiness(
  supabase: SupabaseClient,
  brand: {
    id: string;
    slug: string;
    plan: string | null;
    website?: string | null;
    ads_settings?: unknown;
    zernio_profile_id?: string | null;
    activated_at?: string | null;
    status?: string;
    actorEmail?: string | null;
  },
  channel: AdsChannel
): Promise<{ checks: AdsCheck[]; ready: boolean; adAccounts: { id: string; platform: string; name: string | null; currency: string | null }[] }> {
  const base = `/app/${brand.slug}`;
  const settings = parseAdsSettings(brand.ads_settings);

  const [{ data: allAccounts }, { data: socials }] = await Promise.all([
    // Blocked accounts included on purpose: filtering them out here made a disabled account look
    // like no account at all, and the checklist told the user to "sync after authorising" when
    // the real fix was a payment or an appeal on the platform.
    supabase
      .from('zernio_ad_accounts')
      .select('id, platform, name, currency, status, unusable_reason')
      .eq('brand_id', brand.id),
    supabase
      .from('social_accounts')
      .select('platform, status')
      .eq('brand_id', brand.id)
      .eq('status', 'active')
  ]);

  const wanted: readonly string[] = channel === 'google' ? ['googleads'] : SOCIAL_ADS_PLATFORMS;
  const forChannel = (allAccounts ?? []).filter((a) => wanted.includes(toAdsPlatform(a.platform)));
  const channelAccounts = forChannel.filter((a) => a.status === 'active');
  const blockedAccounts = forChannel.filter((a) => a.status !== 'active');
  const hasFacebook = (socials ?? []).some((s) => (s.platform ?? '').toLowerCase() === 'facebook');

  const countries = settings.defaultCountries ?? [];
  const targetsEu = countries.some((c) => EU_COUNTRIES.has(c));
  const hasDsa = !!settings.dsaBeneficiary && !!settings.dsaPayor;

  // A single credit check for the channel: the cheapest campaign we would let them launch.
  const minLaunch = creditsForSpend(Math.max(5, Math.min(25, settings.dailyBudgetCap ?? 25)));
  const afford = await canAffordAdsCredits(supabase, brand, minLaunch);

  const checks: AdsCheck[] = [
    {
      key: 'plan',
      ok: adsAvailable(brand.plan, brand.actorEmail),
      blocking: true,
      fix: `${base}/settings/ads`
    },
    {
      key: 'profile',
      ok: !!brand.zernio_profile_id,
      blocking: true,
      fix: `${base}/settings/connected-accounts`
    },
    {
      key: 'connection',
      // Meta ads run on a Facebook token with ads scopes — an Instagram-only connection cannot
      // grant them. Google needs its own OAuth, separate from any Google social connection.
      ok: channel === 'google' ? channelAccounts.length > 0 : hasFacebook || channelAccounts.length > 0,
      blocking: true,
      fix: `${base}/settings/ads/accounts`
    },
    {
      key: blockedAccounts.length && !channelAccounts.length ? 'adAccountBlocked' : 'adAccount',
      ok: channelAccounts.length > 0,
      blocking: true,
      fix: `${base}/settings/ads/accounts`,
      detail: channelAccounts.length
        ? channelAccounts.map((a) => a.name ?? a.platform).join(', ')
        : blockedAccounts
            .map((a) => `${a.name ?? a.platform} (${a.unusable_reason ?? 'blocked'})`)
            .join(', ') || undefined
    },
    // No 'caps' check: the budget belongs to the campaign. The daily/monthly caps in settings are
    // an optional ceiling on top of it (budgetBlocked applies them only when set), so listing them
    // as a prerequisite asked for a global number before the user had a first campaign to size.
    {
      key: 'credits',
      ok: afford.ok,
      blocking: true,
      fix: `${base}/credits`,
      detail: String(minLaunch)
    },
    {
      key: 'landing',
      ok: !!brand.website,
      // Google traffic ads need a destination; on social a boost can run without one.
      blocking: channel === 'google',
      fix: `${base}/settings/brand`
    },
    {
      key: 'dsa',
      ok: !targetsEu || hasDsa,
      blocking: channel !== 'google' && targetsEu,
      fix: `${base}/settings/ads`
    }
  ];

  return {
    checks,
    ready: checks.every((c) => c.ok || !c.blocking),
    adAccounts: channelAccounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      name: a.name,
      currency: a.currency
    }))
  };
}

/**
 * Pause everything that is live on the platform. Used when a brand runs out of credits: we stop
 * managing what we can no longer bill for, rather than silently keep spending the user's money.
 */
export async function pauseLiveCampaigns(
  supabase: SupabaseClient,
  brandId: string,
  reason: string
): Promise<number> {
  const { data: live } = await supabase
    .from('ad_campaigns')
    .select('id')
    .eq('brand_id', brandId)
    .in('status', ['active', 'pending_review'])
    .not('zernio_ad_id', 'is', null);

  let paused = 0;
  for (const c of live ?? []) {
    const res = await pauseCampaign(supabase, brandId, c.id);
    if (res.ok) {
      paused++;
      await supabase.from('ad_campaigns').update({ error: reason }).eq('id', c.id);
    }
  }
  return paused;
}

/** Aggregate paid metrics for analytics UI / recap. Empty while the feature is off. */
export async function getPaidSummary(
  supabase: SupabaseClient,
  brandId: string,
  opts: { channel?: AdsChannel; email?: string | null } = {}
) {
  if (!adsFeatureEnabled(opts.email)) {
    return {
      campaigns: [],
      totals: { spend: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, active: 0, proposed: 0 },
      series: [] as { date: string; spend: number; impressions: number; clicks: number }[],
      accountAds: [] as AccountAdRow[]
    };
  }
  let campaignQuery = supabase
    .from('ad_campaigns')
    .select(
      'id, name, platform, ad_type, status, goal, budget_amount, budget_type, currency, review_status, proposal_reason, post_id, created_at, approved_at, zernio_ad_id, external_ids, error'
    )
    .eq('brand_id', brandId);
  if (opts.channel === 'google') campaignQuery = campaignQuery.eq('platform', 'googleads');
  else if (opts.channel === 'social') campaignQuery = campaignQuery.neq('platform', 'googleads');

  const [{ data: campaigns }, { data: metrics }] = await Promise.all([
    campaignQuery.order('created_at', { ascending: false }).limit(100),
    supabase
      .from('ad_metrics')
      .select(
        'campaign_id, spend, impressions, clicks, reach, ctr, cpc, cpm, conversions, roas, period_start, period_end, synced_at'
      )
      .eq('brand_id', brandId)
      .order('period_end', { ascending: true })
      .limit(500)
  ]);

  const campaignIds = new Set((campaigns ?? []).map((c) => c.id));
  const channelMetrics = (metrics ?? []).filter((m) => campaignIds.has(m.campaign_id));

  const latestByCampaign = new Map<string, (typeof channelMetrics)[number]>();
  for (const m of [...channelMetrics].reverse()) {
    if (!latestByCampaign.has(m.campaign_id)) latestByCampaign.set(m.campaign_id, m);
  }

  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalReach = 0;
  let totalConversions = 0;
  for (const m of latestByCampaign.values()) {
    totalSpend += Number(m.spend) || 0;
    totalImpressions += Number(m.impressions) || 0;
    totalClicks += Number(m.clicks) || 0;
    totalReach += Number(m.reach) || 0;
    totalConversions += Number(m.conversions) || 0;
  }

  // Snapshot series for charts — bucket by period_end (sync windows, not true daily if rare).
  const byDate = new Map<string, { spend: number; impressions: number; clicks: number }>();
  for (const m of channelMetrics) {
    const date = String(m.period_end).slice(0, 10);
    const cur = byDate.get(date) ?? { spend: 0, impressions: 0, clicks: 0 };
    cur.spend += Number(m.spend) || 0;
    cur.impressions += Number(m.impressions) || 0;
    cur.clicks += Number(m.clicks) || 0;
    byDate.set(date, cur);
  }
  const series = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, v]) => ({ date, ...v }));

  // WHY a campaign's numbers moved, not just that they moved. Without this every decay looks like
  // the same event and invites the same answer ("make new creative"), which is the wrong answer for
  // an audience-size problem, for auction pressure, and — most expensively — for a broken pixel.
  // See `ads-fatigue.ts`; the diagnosis is deterministic and costs nothing.
  const historyByCampaign = new Map<string, AdMetricPoint[]>();
  for (const m of channelMetrics) {
    const list = historyByCampaign.get(m.campaign_id) ?? [];
    list.push({
      periodEnd: String(m.period_end ?? '').slice(0, 10),
      spend: Number(m.spend) || 0,
      impressions: Number(m.impressions) || 0,
      clicks: Number(m.clicks) || 0,
      reach: m.reach == null ? null : Number(m.reach) || 0,
      conversions: m.conversions == null ? null : Number(m.conversions) || 0
    });
    historyByCampaign.set(m.campaign_id, list);
  }
  const diagnosisByCampaign = new Map<string, ReturnType<typeof diagnoseFatigue>>();
  for (const [campaignId, history] of historyByCampaign) {
    diagnosisByCampaign.set(campaignId, diagnoseFatigue(history));
  }

  return {
    campaigns: (campaigns ?? []).map((c) => ({
      ...c,
      metrics: latestByCampaign.get(c.id) ?? null,
      fatigue: diagnosisByCampaign.get(c.id) ?? null,
      source: 'anomalia' as const
    })),
    totals: {
      spend: totalSpend,
      impressions: totalImpressions,
      clicks: totalClicks,
      reach: totalReach,
      conversions: totalConversions,
      active: (campaigns ?? []).filter((c) => ['active', 'pending_review'].includes(c.status)).length,
      proposed: (campaigns ?? []).filter((c) => c.status === 'proposed').length
    },
    series,
    accountAds: [] as AccountAdRow[]
  };
}

export type AccountAdRow = {
  id: string;
  name: string | null;
  platform: string | null;
  status: string | null;
  reviewStatus: string | null;
  goal: string | null;
  budgetAmount: number | null;
  budgetType: string | null;
  currency: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  roas: number | null;
  ours: boolean;
  platformCampaignId: string | null;
  platformAdId: string | null;
};

/** Ads already on the connected ad account (Zernio source=all), filtered to this channel. */
export async function listAccountAdsForChannel(
  brand: { zernio_profile_id?: string | null },
  channel: AdsChannel,
  ourZernioAdIds: Set<string>
): Promise<AccountAdRow[]> {
  if (!brand.zernio_profile_id) return [];
  let ads: ZernioAd[] = [];
  try {
    ads = await listAds({ profileId: brand.zernio_profile_id, source: 'all', limit: 100 });
  } catch (e) {
    console.warn('[ads] listAds failed', e instanceof Error ? e.message : e);
    return [];
  }

  return ads
    .filter((a) => {
      const plat = toAdsPlatform(a.platform ?? '');
      return channel === 'google' ? plat === 'googleads' : plat !== 'googleads';
    })
    .map((a) => {
      const m = a.metrics ?? {};
      const num = (x: unknown) => {
        const n = Number(x);
        return Number.isFinite(n) ? n : 0;
      };
      const numOrNull = (x: unknown) => {
        if (x == null || x === '') return null;
        const n = Number(x);
        return Number.isFinite(n) ? n : null;
      };
      return {
        id: a.id,
        name: a.name,
        platform: a.platform,
        status: a.status,
        reviewStatus: a.reviewStatus,
        goal: a.goal,
        budgetAmount: a.budget?.amount ?? null,
        budgetType: a.budget?.type ?? null,
        currency: a.budget?.currency ?? null,
        spend: num(m.spend),
        impressions: num(m.impressions),
        clicks: num(m.clicks),
        ctr: numOrNull(m.ctr),
        cpc: numOrNull(m.cpc),
        roas: numOrNull(m.roas),
        ours: ourZernioAdIds.has(a.id),
        platformCampaignId: a.platformCampaignId,
        platformAdId: a.platformAdId
      };
    });
}

/** Short prompt block of recent paid winners for the organic planner flywheel. */
export async function formatPaidWinnersBrief(
  supabase: SupabaseClient,
  brandId: string
): Promise<string> {
  try {
    const summary = await getPaidSummary(supabase, brandId);
    const winners = summary.campaigns
      .filter((c) => c.metrics && Number(c.metrics.spend) > 0)
      .slice(0, 5);
    if (!winners.length) return '';
    const lines = winners.map((c) => {
      const m = c.metrics!;
      // The diagnosis travels with the number. "Spent money" and "worked" are different claims, and
      // a campaign whose CTR is sliding against a rising frequency is an angle to STOP copying, not
      // a winner to imitate — which is exactly what the old label told the planner to do.
      const fatigue = c.fatigue ? ` · lettura: ${c.fatigue.label.toLowerCase()}` : '';
      return `- [${c.platform} · ${c.ad_type} · ${c.goal}] ${c.name} — spend ${Number(m.spend).toFixed(0)}, clicks ${m.clicks ?? 0}, ROAS ${m.roas ?? 'n/a'}${fatigue}`;
    });
    // Longevity and spend are the only real signals here: nobody funds a loser for long. That is
    // inference from spending behaviour, not measured creative performance, and saying so is what
    // stops the planner from treating a budget decision as a proven angle.
    return (
      `\nRECENT PAID SPEND (Zernio — ranked by spend, NOT by proven performance: sustained spend is a signal that ` +
      `someone kept funding it, which is inference, not measurement). Prefer organic angles that match the concepts ` +
      `still healthy below; do NOT copy a concept whose reading says fatigue, exhausted audience or bad concept:\n` +
      lines.join('\n') +
      '\n'
    );
  } catch {
    return '';
  }
}
