import { env } from '$env/dynamic/private';

// Zernio Ads API client — wraps /v1/ads/* (boost, create, accounts, analytics).
// Organic publish/analytics stay in zernio.ts; this module is paid-only.

const BASE = 'https://zernio.com/api/v1';

function apiKey(): string {
  const k = env.ZERNIO_API_KEY;
  if (!k) throw new Error('ZERNIO_API_KEY not configured');
  return k;
}

async function zfetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) throw new Error(`Zernio ${res.status}: ${await res.text()}`);
  // Some DELETE/empty responses
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function objId(o: any): string | undefined {
  return o?.id ?? o?._id;
}

export type AdGoal =
  | 'engagement'
  | 'traffic'
  | 'awareness'
  | 'video_views'
  | 'lead_generation'
  | 'lead_conversion'
  | 'conversions'
  | 'app_promotion'
  | 'catalog_sales'
  | 'job_applicants';

export type AdBudget = {
  amount: number;
  type: 'daily' | 'lifetime';
  currency?: string;
};

export type AdTargeting = {
  age_min?: number;
  age_max?: number;
  genders?: string[];
  countries?: string[];
  languages?: string[];
  interests?: { id: string; name?: string }[];
  keywords?: { text: string; matchType?: 'BROAD' | 'PHRASE' | 'EXACT' }[];
  geoTargets?: string[];
};

export type ZernioAdAccount = {
  id: string;
  platform: string | null;
  name: string | null;
  currency: string | null;
  socialAccountId: string | null;
  platformAdAccountId: string | null;
  status: string | null;
  /** Platform's own reason the account cannot run ads (Meta: ACCOUNT_DISABLED, UNSETTLED, …). */
  unusableReason: string | null;
};

export type ZernioAd = {
  id: string;
  name: string | null;
  platform: string | null;
  status: string | null;
  reviewStatus: string | null;
  adType: string | null;
  goal: string | null;
  budget: AdBudget | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metrics: Record<string, any> | null;
  platformAdId: string | null;
  platformCampaignId: string | null;
  platformAdSetId: string | null;
  platformAdAccountId: string | null;
};

export type ZernioAdAnalytics = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  conversions: number | null;
  roas: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapAdAccount(a: any): ZernioAdAccount | null {
  const id = String(objId(a) ?? a?.adAccountId ?? a?.platformAdAccountId ?? '');
  if (!id) return null;
  return {
    id,
    platform: a?.platform ?? a?.network ?? null,
    name: a?.name ?? a?.accountName ?? a?.platformAdAccountName ?? null,
    currency: a?.currency ?? a?.currencyCode ?? null,
    socialAccountId: a?.accountId ? String(objId(a.accountId) ?? a.accountId) : a?.socialAccountId ?? null,
    platformAdAccountId: a?.platformAdAccountId ?? a?.adAccountId ?? id,
    // `selectable` is the platform-agnostic "can this account run ads right now" — accountStatus
    // is an integer on Meta and a string elsewhere, so reading it directly means writing a
    // per-platform vocabulary. An account disabled for an unpaid balance used to show up green,
    // right where the user picks where to spend, and the campaign failed after approval.
    status:
      a?.status ??
      (a?.selectable === false || a?.unusableReason || a?.isActive === false ? 'inactive' : 'active'),
    unusableReason:
      a?.unusableReason ??
      // Meta answers `selectable: false` with no reason more often than not; say that plainly
      // rather than leave the UI with nothing to show.
      (a?.selectable === false ? 'NOT_SELECTABLE' : null)
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAd(a: any): ZernioAd | null {
  const id = String(objId(a) ?? '');
  if (!id) return null;
  const budget = a?.budget
    ? {
        amount: Number(a.budget.amount) || 0,
        type: (a.budget.type === 'lifetime' ? 'lifetime' : 'daily') as 'daily' | 'lifetime',
        currency: a.budget.currency
      }
    : null;
  return {
    id,
    name: a?.name ?? null,
    platform: a?.platform ?? null,
    status: a?.status ?? a?.configuredStatus ?? null,
    reviewStatus: a?.reviewStatus ?? null,
    adType: a?.adType ?? null,
    goal: a?.goal ?? null,
    budget,
    metrics: a?.metrics ?? null,
    platformAdId: a?.platformAdId ?? null,
    platformCampaignId: a?.platformCampaignId ?? null,
    platformAdSetId: a?.platformAdSetId ?? null,
    platformAdAccountId: a?.platformAdAccountId ?? null
  };
}

/** List ad accounts reachable from a Zernio profile (and optionally a social account). */
export async function listAdAccounts(opts: {
  profileId?: string;
  accountId?: string;
}): Promise<ZernioAdAccount[]> {
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.accountId) params.set('accountId', opts.accountId);
  const qs = params.toString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await zfetch(`/ads/accounts${qs ? `?${qs}` : ''}`);
  } catch (e) {
    // Some Zernio plans return 402 without Ads; treat as empty rather than hard-fail sync.
    const msg = String(e);
    if (msg.includes('402') || msg.includes('403') || msg.includes('404')) return [];
    throw e;
  }
  const raw = Array.isArray(data?.accounts)
    ? data.accounts
    : Array.isArray(data?.adAccounts)
      ? data.adAccounts
      : Array.isArray(data)
        ? data
        : [];
  return raw.map(mapAdAccount).filter((a: ZernioAdAccount | null): a is ZernioAdAccount => !!a);
}

export type BoostPostInput = {
  postId?: string;
  platformPostId?: string;
  accountId: string;
  adAccountId: string;
  name: string;
  goal: AdGoal;
  budget: AdBudget;
  schedule?: { startDate?: string; endDate?: string };
  targeting?: AdTargeting;
  platform?: string;
  linkUrl?: string;
  callToAction?: string;
  dsaBeneficiary?: string;
  dsaPayor?: string;
};

/** Promote an existing organic post. Meta / TikTok / LinkedIn / Pinterest / X — not Google. */
export async function boostPost(input: BoostPostInput, idempotencyKey?: string): Promise<ZernioAd> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const data = await zfetch('/ads/boost', {
    method: 'POST',
    headers,
    body: JSON.stringify(input)
  });
  const ad = mapAd(data?.ad ?? data);
  if (!ad) throw new Error('Zernio boost: no ad in response');
  return ad;
}

/**
 * One ad inside a campaign. Meta's model is campaign → ad set → N ads, and Zernio exposes it via
 * `creatives[]`: every entry becomes its own ad, sharing the ad set's budget, targeting and
 * schedule. That is what makes an A/B real — variants competing in the SAME auction slot.
 */
export type AdCreativeVariant = {
  name?: string;
  headline?: string;
  body?: string;
  description?: string;
  imageUrl?: string;
  videoUrl?: string;
  linkUrl?: string;
  callToAction?: string;
};

export type CreateStandaloneAdInput = {
  accountId: string;
  adAccountId: string;
  name: string;
  goal: AdGoal;
  budget: AdBudget;
  platform?: string;
  campaignType?: 'SEARCH' | 'DISPLAY';
  schedule?: { startDate?: string; endDate?: string };
  targeting?: AdTargeting;
  creative?: {
    headline?: string;
    headlines?: string[];
    body?: string;
    descriptions?: string[];
    imageUrl?: string;
    /** Google Responsive Display needs BOTH a 1.91:1 and a 1:1 image; one alone is rejected. */
    squareImageUrl?: string;
    /**
     * Meta only. Vertical asset pinned to Stories/Reels while `imageUrl` serves Feed — Meta's
     * "different creative per placement". A 1:1 feed image letterboxed into a 9:16 slot is the
     * single most common way a good ad looks cheap.
     */
    storyImageUrl?: string;
    videoUrl?: string;
    callToAction?: string;
    landingPageUrl?: string;
    linkUrl?: string;
    /** Google Display only: advertiser name shown on the ad (max 25 chars). */
    businessName?: string;
  };
  /** Meta only. When set, `creative` is ignored and one ad is created per entry. */
  creatives?: AdCreativeVariant[];
  placements?: string[];
  dsaBeneficiary?: string;
  dsaPayor?: string;
  /** Validate the whole campaign tree against the platform and create nothing. */
  validateOnly?: boolean;
};

/**
 * POST /v1/ads/create takes a FLAT body: every field at the top level, `budgetAmount`/`budgetType`
 * instead of a budget object, targeting spread out as countries/ageMin/…, and NO `platform` (it is
 * inferred from accountId). Only /v1/ads/boost takes the nested objects — we were sending the boost
 * shape here, which every create rejected. We keep the structured input internally (it is what
 * ad_campaigns stores) and flatten it only at the HTTP boundary.
 */
export function buildCreatePayload(input: CreateStandaloneAdInput): Record<string, unknown> {
  const c = input.creative ?? {};
  const t = input.targeting ?? {};
  const isGoogle = (input.platform ?? '').toLowerCase() === 'googleads';

  const body: Record<string, unknown> = {
    accountId: input.accountId,
    adAccountId: input.adAccountId,
    name: input.name,
    goal: input.goal,
    budgetAmount: input.budget.amount,
    budgetType: input.budget.type,
    currency: input.budget.currency,
    headline: c.headline,
    body: c.body,
    linkUrl: c.linkUrl ?? c.landingPageUrl,
    callToAction: c.callToAction,
    videoUrl: c.videoUrl,
    additionalHeadlines: c.headlines?.filter((h) => h && h !== c.headline),
    additionalDescriptions: c.descriptions?.filter((d) => d && d !== c.body),
    countries: t.countries,
    languages: t.languages,
    ageMin: t.age_min,
    ageMax: t.age_max,
    genders: t.genders,
    // Google takes plain keyword strings (match types default to broad); Meta takes interests.
    interests: isGoogle ? undefined : t.interests,
    keywords: isGoogle ? t.keywords?.map((k) => k.text).filter(Boolean) : undefined,
    // Lowercase per the Google docs ('search' | 'display'); we store the enum uppercase.
    campaignType: input.campaignType ? input.campaignType.toLowerCase() : undefined,
    businessName: c.businessName,
    // Display wants the pair under `images`; every other platform wants a single imageUrl.
    imageUrl: isGoogle && c.squareImageUrl ? undefined : c.imageUrl,
    images: isGoogle && c.squareImageUrl ? { landscape: c.imageUrl, square: c.squareImageUrl } : undefined,
    startDate: input.schedule?.startDate,
    endDate: input.schedule?.endDate,
    placements: input.placements,
    dsaBeneficiary: input.dsaBeneficiary,
    dsaPayor: input.dsaPayor,
    validateOnly: input.validateOnly || undefined
  };

  // Placement asset customisation (Meta only): the same ad, a vertical asset on Stories/Reels and
  // the feed asset everywhere else. Mutually exclusive with the multi-creative shape below, which
  // is why it is applied first and skipped when `creatives` is present.
  if (!isGoogle && !input.creatives?.length && c.storyImageUrl && c.imageUrl) {
    body.placementAssets = {
      defaultImageUrl: c.imageUrl,
      rules: [
        {
          placements: {
            instagramPositions: ['story', 'reels'],
            facebookPositions: ['story', 'facebook_reels']
          },
          imageUrl: c.storyImageUrl
        }
      ]
    };
    delete body.imageUrl;
  }

  // Multi-creative shape (Meta only): 1 campaign + 1 ad set + N ads sharing budget and targeting.
  // Zernio IGNORES the top-level copy/media in this mode, so we drop it rather than send a payload
  // that reads as if it mattered. validateOnly is not supported on this shape either.
  if (!isGoogle && input.creatives?.length) {
    for (const k of ['headline', 'body', 'linkUrl', 'callToAction', 'videoUrl', 'imageUrl', 'images', 'validateOnly']) {
      delete body[k];
    }
    body.creatives = input.creatives.map((v) => ({
      name: v.name,
      headline: v.headline,
      body: v.body,
      description: v.description,
      imageUrl: v.imageUrl,
      video: v.videoUrl ? { url: v.videoUrl } : undefined,
      linkUrl: v.linkUrl,
      callToAction: v.callToAction
    }));
  }

  for (const k of Object.keys(body)) {
    const v = body[k];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) delete body[k];
  }
  return body;
}

/**
 * Create a standalone (dark) ad — Meta, Google Search/Display, TikTok, LinkedIn, etc.
 *
 * The 201 comes back in TWO shapes: `{ ad }` for a single creative, `{ ads[], platformCampaignId,
 * platformAdSetId }` for the multi-creative one. Always returns the full list: reading only the
 * first would strand the other ads — live, spending, and unknown to us, so neither pause nor
 * metrics would ever reach them.
 */
export async function createStandaloneAd(
  input: CreateStandaloneAdInput,
  idempotencyKey?: string
): Promise<{ ads: ZernioAd[]; platformCampaignId?: string; platformAdSetId?: string }> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const data = await zfetch('/ads/create', {
    method: 'POST',
    headers,
    body: JSON.stringify(buildCreatePayload(input))
  });
  const raw = Array.isArray(data?.ads) ? data.ads : [data?.ad ?? data];
  const ads = raw.map(mapAd).filter((a: ZernioAd | null): a is ZernioAd => !!a);
  if (!ads.length) throw new Error('Zernio create: no ad in response');
  return {
    ads,
    platformCampaignId: data?.platformCampaignId ?? ads[0].platformCampaignId ?? undefined,
    platformAdSetId: data?.platformAdSetId ?? ads[0].platformAdSetId ?? undefined
  };
}

/**
 * Dry-run the same create against the platform (validateOnly: true): nothing is created, no money
 * moves. The readiness panel uses it so a broken ad account or creative surfaces BEFORE the user
 * approves a spend, not after.
 */
export async function validateStandaloneAd(
  input: CreateStandaloneAdInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await zfetch('/ads/create', {
      method: 'POST',
      body: JSON.stringify(buildCreatePayload({ ...input, validateOnly: true }))
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getAd(adId: string): Promise<ZernioAd | null> {
  try {
    const data = await zfetch(`/ads/${encodeURIComponent(adId)}`);
    return mapAd(data?.ad ?? data);
  } catch (e) {
    if (String(e).includes('404')) return null;
    throw e;
  }
}

export async function updateAd(
  adId: string,
  patch: { status?: 'active' | 'paused'; budget?: AdBudget; name?: string }
): Promise<ZernioAd> {
  const data = await zfetch(`/ads/${encodeURIComponent(adId)}`, {
    method: 'PUT',
    // PUT /ads/{adId} takes `one of: active, paused` — LOWERCASE. Only POST /ads/create uses the
    // uppercase ACTIVE/PAUSED. Sending the create casing here risks a validation reject, and a
    // rejected pause means the user cannot stop a campaign that is spending.
    body: JSON.stringify(patch)
  });
  const ad = mapAd(data?.ad ?? data);
  if (!ad) throw new Error('Zernio update: no ad in response');
  return ad;
}

/**
 * Ad analytics over an EXPLICIT window. Omitting the range silently means "last 90 days", which
 * made every figure a sliding window: a campaign stopped two months ago still showed its full
 * spend, the totals never matched the platform invoice, and the fee stopped accruing on anything
 * older than 90 days. Pass the campaign's own lifetime instead. (Zernio caps a range at 730 days.)
 */
export async function getAdAnalytics(
  adId: string,
  range?: { fromDate?: string; toDate?: string }
): Promise<ZernioAdAnalytics> {
  const qs = new URLSearchParams();
  if (range?.fromDate) qs.set('fromDate', range.fromDate);
  if (range?.toDate) qs.set('toDate', range.toDate);
  const suffix = qs.toString() ? `?${qs}` : '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await zfetch(`/ads/${encodeURIComponent(adId)}/analytics${suffix}`);
  const m = data?.metrics ?? data ?? {};
  const num = (x: unknown): number => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  };
  const numOrNull = (x: unknown): number | null => {
    if (x == null || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  return {
    spend: num(m.spend),
    impressions: num(m.impressions),
    reach: num(m.reach),
    clicks: num(m.clicks),
    ctr: numOrNull(m.ctr),
    cpc: numOrNull(m.cpc),
    cpm: numOrNull(m.cpm),
    conversions: numOrNull(m.conversions),
    roas: numOrNull(m.roas),
    raw: data
  };
}

/** List ads for a profile / ad account (includes externally synced when source=all). */
export async function listAds(opts: {
  profileId?: string;
  adAccountId?: string;
  source?: 'all' | 'zernio';
  page?: number;
  limit?: number;
}): Promise<ZernioAd[]> {
  const params = new URLSearchParams();
  if (opts.profileId) params.set('profileId', opts.profileId);
  if (opts.adAccountId) params.set('adAccountId', opts.adAccountId);
  if (opts.source) params.set('source', opts.source);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit ?? 50));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await zfetch(`/ads?${params.toString()}`);
  } catch (e) {
    if (String(e).includes('402') || String(e).includes('404')) return [];
    throw e;
  }
  const raw = Array.isArray(data?.ads) ? data.ads : Array.isArray(data) ? data : [];
  return raw.map(mapAd).filter((a: ZernioAd | null): a is ZernioAd => !!a);
}

/**
 * Duplicate a campaign on the platform — ad sets, ads, creatives and targeting by default
 * (deepCopy). The copy is created PAUSED so callers review before launching. Response carries the
 * new platform campaign id; Zernio triggers discovery on the account automatically.
 * Meta-only for now; other platforms return 501 and throw.
 */
export async function duplicateCampaign(input: {
  platformCampaignId: string;
  platform: 'facebook' | 'instagram' | 'tiktok' | 'linkedin';
  deepCopy?: boolean;
  statusOption?: 'ACTIVE' | 'PAUSED' | 'INHERITED_FROM_SOURCE';
  renameStrategy?: 'DEEP_RENAME' | 'ONLY_TOP_LEVEL_RENAME' | 'NO_RENAME';
  renamePrefix?: string;
  renameSuffix?: string;
  syncAfter?: boolean;
}): Promise<{ copiedCampaignId: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await zfetch(
    `/ads/campaigns/${encodeURIComponent(input.platformCampaignId)}/duplicate`,
    {
      method: 'POST',
      body: JSON.stringify({
        platform: input.platform,
        deepCopy: input.deepCopy ?? true,
        statusOption: input.statusOption ?? 'PAUSED',
        ...(input.renameStrategy ? { renameStrategy: input.renameStrategy } : {}),
        ...(input.renamePrefix ? { renamePrefix: input.renamePrefix } : {}),
        ...(input.renameSuffix ? { renameSuffix: input.renameSuffix } : {}),
        ...(input.syncAfter !== undefined ? { syncAfter: input.syncAfter } : {})
      })
    }
  );
  const copiedCampaignId = String(data?.copiedCampaignId ?? '');
  if (!copiedCampaignId) throw new Error('Zernio duplicate: no copiedCampaignId in response');
  return { copiedCampaignId };
}

/** Delete a whole campaign, cascading to its ad sets and ads. Meta-only; 501 on others. */
export async function deleteCampaign(
  platformCampaignId: string,
  platform: 'facebook' | 'instagram'
): Promise<void> {
  await zfetch(`/ads/campaigns/${encodeURIComponent(platformCampaignId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ platform })
  });
}

/** Cancel one ad on the platform (fallback for non-Meta campaigns, which 501 on delete). */
export async function deleteAd(adId: string): Promise<void> {
  await zfetch(`/ads/${encodeURIComponent(adId)}`, { method: 'DELETE' });
}

/** Pause or resume a campaign — one platform call, status cascades to all its ads. */
export async function updateCampaignStatus(
  platformCampaignId: string,
  status: 'active' | 'paused',
  platform: string
): Promise<void> {
  await zfetch(`/ads/campaigns/${encodeURIComponent(platformCampaignId)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, platform })
  });
}
