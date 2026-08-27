import { swallow } from '$lib/server/swallow';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, ServerLoadEvent } from '@sveltejs/kit';
import { adsSelfServeEnabled } from '$lib/ads-fee';
import { isAdsPreviewUser } from '$lib/server/internal-users';
import {
  adsAvailable,
  adsFeatureEnabled,
  adsReadiness,
  approveCampaign,
  getPaidSummary,
  listAccountAdsForChannel,
  pauseCampaign,
  proposeBoosts,
  proposeStandalone,
  rankBoostCandidates,
  rejectCampaign,
  setCampaignStatus,
  setCreativeStatus,
  syncAdAccounts,
  syncAdMetrics,
  type AdGoal,
  type AdsChannel
} from '$lib/server/ads';
import { generateCampaignDraft } from '$lib/server/ads-generate';
import { normalizeUrl } from '$lib/ads-fee';
import { withBrandContext } from '$lib/server/ai-log';

// Social ads and Google ads are the same machinery pointed at different networks, so the two
// routes share one loader and one action set. Only the channel differs.

/** Temporary: automatic ads are sales-activated via a booking call, not self-serve yet. */
function refuseUntilSelfServe() {
  return fail(403, { error: 'ads_book_call' });
}

const BRAND_COLS =
  'id, slug, name, plan, status, website, activated_at, ads_settings, zernio_profile_id';

type AdsBrand = {
  id: string;
  slug: string;
  name: string;
  plan: string | null;
  status: string;
  website: string | null;
  activated_at: string | null;
  ads_settings: unknown;
  zernio_profile_id: string | null;
  actorEmail?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadBrand(supabase: any, slug: string, email?: string | null): Promise<AdsBrand | null> {
  const { data } = await supabase.from('brands').select(BRAND_COLS).eq('slug', slug).maybeSingle();
  if (!data) return null;
  return { ...(data as AdsBrand), actorEmail: email ?? null };
}

function actorEmail(event: {
  locals: { safeGetSession: () => Promise<{ user: { email?: string | null } | null }> };
}): Promise<string | null> {
  return event.locals.safeGetSession().then((s) => s.user?.email ?? null);
}

export function adsChannelLoad(channel: AdsChannel) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async ({ parent, locals: { supabase, safeGetSession }, url }: ServerLoadEvent<any, any>) => {
    const { brand } = (await parent()) as { brand: AdsBrand };
    const { user } = await safeGetSession();
    const email = user?.email ?? null;

    // Kill switch first: an unreleased surface must 404, not redirect to a paywall for it.
    // Preview allowlist (Andrea / Marco) always passes.
    if (!adsFeatureEnabled(email)) throw error(404, 'Not found');

    const selfServe = adsSelfServeEnabled(isAdsPreviewUser(email));

    // While self-serve is off, every visitor (any plan) sees the book-a-call placeholder — no
    // heavy ads queries, no plan paywall redirect. Preview allowlist still gets the full UI.
    if (!selfServe) {
      return {
        channel,
        selfServe: false,
        summary: {
          campaigns: [],
          totals: {
            spend: 0,
            impressions: 0,
            clicks: 0,
            reach: 0,
            conversions: 0,
            active: 0,
            proposed: 0
          },
          series: [],
          accountAds: []
        },
        readiness: { ready: false, checks: [], adAccounts: [] },
        candidates: [],
        justConnected: false
      };
    }

    // Settings page, not /upgrade — opening a URL must not start a Stripe flow.
    if (!adsAvailable(brand.plan, email)) throw redirect(303, `/app/${brand.slug}/settings/ads`);

    // Coming back from an ads OAuth, an explicit refresh — or simply having no ad account stored
    // yet: turn the authorisation into ad account rows before rendering the checklist that asks
    // for them. Without the last case the checklist told an already-authorised user to "sync
    // after authorising" forever, because nothing on a plain page load ever synced.
    const { count: storedAdAccounts } = await supabase
      .from('zernio_ad_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id);
    if (
      !storedAdAccounts ||
      url.searchParams.get('connected') === '1' ||
      url.searchParams.get('refresh') === '1'
    ) {
      await syncAdAccounts(supabase, brand).catch((error) => { swallow('sync ad accounts', error); return 0; });
      await syncAdMetrics(supabase, brand.id).catch((error) => { swallow('sync ad metrics', error); return 0; });
    }

    const [summary, readiness, candidates] = await Promise.all([
      getPaidSummary(supabase, brand.id, { channel, email }),
      adsReadiness(supabase, { ...brand, actorEmail: email }, channel),
      // Boosting an organic winner only exists on social — Google has no organic post to promote.
      channel === 'social'
        ? rankBoostCandidates(supabase, brand.id, { limit: 8 })
        : Promise.resolve([])
    ]);

    const ourIds = new Set(
      summary.campaigns.map((c) => c.zernio_ad_id).filter((id): id is string => !!id)
    );
    const accountAds = await listAccountAdsForChannel(brand, channel, ourIds).catch((error) => { swallow('list channel ads', error); return []; });

    return {
      channel,
      selfServe: true,
      summary: { ...summary, accountAds },
      readiness,
      candidates,
      justConnected: url.searchParams.get('connected') === '1'
    };
  };
}

export function adsChannelActions(channel: AdsChannel): Actions {
  return {
    sync: async (event) => {
      const email = await actorEmail(event);
      if (!adsSelfServeEnabled(isAdsPreviewUser(email))) return refuseUntilSelfServe();
      const brand = await loadBrand(event.locals.supabase, event.params.brand!, email);
      if (!brand || !adsAvailable(brand.plan, email)) return fail(403, { error: 'ads_not_on_plan' });
      const accounts = await syncAdAccounts(event.locals.supabase, brand);
      const metrics = await syncAdMetrics(event.locals.supabase, brand.id);
      return { synced: { accounts, metrics } };
    },

    propose: async (event) => {
      const email = await actorEmail(event);
      if (!adsSelfServeEnabled(isAdsPreviewUser(email))) return refuseUntilSelfServe();
      const brand = await loadBrand(event.locals.supabase, event.params.brand!, email);
      if (!brand || !adsAvailable(brand.plan, email)) return fail(403, { error: 'ads_not_on_plan' });
      if (channel !== 'social') return fail(400, { error: 'boost_social_only' });
      return { proposed: await proposeBoosts(event.locals.supabase, brand) };
    },

    approve: async (event) => {
      const email = await actorEmail(event);
      if (!adsSelfServeEnabled(isAdsPreviewUser(email))) return refuseUntilSelfServe();
      const brand = await loadBrand(event.locals.supabase, event.params.brand!, email);
      if (!brand || !adsAvailable(brand.plan, email)) return fail(403, { error: 'ads_not_on_plan' });

      const fd = await event.request.formData();
      const campaignId = String(fd.get('campaignId') ?? '');
      if (!campaignId) return fail(400, { error: 'missing_campaign' });

      const budgetRaw = fd.get('budgetAmount');
      const budgetAmount = budgetRaw != null && String(budgetRaw) !== '' ? Number(budgetRaw) : undefined;
      const goal = (fd.get('goal') as AdGoal | null) || undefined;

      const result = await approveCampaign(event.locals.supabase, brand, campaignId, {
        budgetAmount: Number.isFinite(budgetAmount) ? budgetAmount : undefined,
        goal
      });
      if (!result.ok) return fail(400, { error: result.error });
      return { approved: result.zernioAdId };
    },

    reject: async (event) => {
      const email = await actorEmail(event);
      if (!adsSelfServeEnabled(isAdsPreviewUser(email))) return refuseUntilSelfServe();
      const brand = await loadBrand(event.locals.supabase, event.params.brand!, email);
      if (!brand) return fail(404, { error: 'not_found' });
      const fd = await event.request.formData();
      await rejectCampaign(event.locals.supabase, brand.id, String(fd.get('campaignId') ?? ''));
      return { rejected: true };
    },

    pause: async (event) => {
      const email = await actorEmail(event);
      if (!adsSelfServeEnabled(isAdsPreviewUser(email))) return refuseUntilSelfServe();
      const brand = await loadBrand(event.locals.supabase, event.params.brand!, email);
      if (!brand) return fail(404, { error: 'not_found' });
      const fd = await event.request.formData();
      const result = await pauseCampaign(
        event.locals.supabase,
        brand.id,
        String(fd.get('campaignId') ?? '')
      );
      if (!result.ok) return fail(400, { error: result.error });
      return { paused: true };
    },

    /** One switch for the whole campaign, one per creative. Same action, different payload. */
    toggle: async (event) => {
      const email = await actorEmail(event);
      if (!adsSelfServeEnabled(isAdsPreviewUser(email))) return refuseUntilSelfServe();
      const brand = await loadBrand(event.locals.supabase, event.params.brand!, email);
      if (!brand) return fail(404, { error: 'not_found' });
      const fd = await event.request.formData();
      const campaignId = String(fd.get('campaignId') ?? '');
      const adId = String(fd.get('adId') ?? '');
      const next = String(fd.get('next') ?? '') === 'active' ? 'active' : 'paused';
      const result = adId
        ? await setCreativeStatus(event.locals.supabase, brand.id, campaignId, adId, next)
        : await setCampaignStatus(event.locals.supabase, brand.id, campaignId, next);
      if (!result.ok) return fail(400, { error: result.error });
      return { toggled: next };
    },

    create: adsCreateAction(channel)
  };
}

/**
 * Turn a (usually AI-written, then user-edited) form into a `proposed` campaign. Shared by the
 * dedicated /ads/{channel}/new page and kept on the channel pages for older links.
 */
function adsCreateAction(channel: AdsChannel): NonNullable<Actions[string]> {
  return async (event) => {
    const email = await actorEmail(event);
    if (!adsSelfServeEnabled(isAdsPreviewUser(email))) return refuseUntilSelfServe();
    const brand = await loadBrand(event.locals.supabase, event.params.brand!, email);
    if (!brand || !adsAvailable(brand.plan, email)) return fail(403, { error: 'ads_not_on_plan' });

    const fd = await event.request.formData();
    const str = (k: string) => String(fd.get(k) ?? '').trim();
    // Repeated inputs (one headline per field) arrive as several entries under the same name;
    // a single textarea still works via the newline split, so old links keep posting fine.
    const list = (k: string) =>
      fd
        .getAll(k)
        .flatMap((v) => String(v).split('\n'))
        .map((s) => s.trim())
        .filter(Boolean);
    // "anomalia.so" is what the AI (and a human) writes — add the scheme instead of rejecting it.
    const url = (k: string) => normalizeUrl(str(k));

    // Social ads are Meta-only for now — ignore any other platform posted from the form.
    const platform = channel === 'google' ? 'googleads' : 'metaads';
    const name = str('name');
    const headline = str('headline');
    if (!name || !headline) return fail(400, { error: 'name_and_headline_required' });

    const campaignTypeRaw = str('campaignType').toUpperCase();
    const campaignType =
      channel === 'google' && (campaignTypeRaw === 'SEARCH' || campaignTypeRaw === 'DISPLAY')
        ? (campaignTypeRaw as 'SEARCH' | 'DISPLAY')
        : undefined;

    // Google Responsive Display is rejected without BOTH image ratios — catch it here rather
    // than after the user has approved the spend.
    if (campaignType === 'DISPLAY' && !(url('imageUrl') && url('squareImageUrl'))) {
      return fail(400, { error: 'display_needs_both_images' });
    }

    const budgetAmount = Number(fd.get('budgetAmount') ?? 25);
    const landing = url('landingPageUrl') || normalizeUrl(brand.website) || '';
    const keywords = list('keywords').map((text) => ({ text }));
    const countries = str('countries')
      .split(/[,\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));
    const ageMin = Number(fd.get('ageMin'));
    const ageMax = Number(fd.get('ageMax'));

    // Extra creatives. The three fields are posted as parallel arrays — one row of the repeater is
    // the same index across them — and a row with neither headline nor image is an empty row the
    // user never filled, not an ad. Google ignores these: it recombines headlines[] inside one ad.
    const vHeadlines = fd.getAll('variantHeadline').map(String);
    const vBodies = fd.getAll('variantBody').map(String);
    const vImages = fd.getAll('variantImageUrl').map(String);
    const variants =
      channel === 'google'
        ? []
        : vHeadlines
            .map((h, i) => ({
              name: `${name} — ${i + 2}`,
              headline: h.trim() || headline,
              body: vBodies[i]?.trim() || str('body') || undefined,
              imageUrl: normalizeUrl(vImages[i] ?? '') || url('imageUrl') || undefined,
              // Each entry carries its own destination: in multi-creative mode Zernio ignores the
              // top-level linkUrl, so an entry without one would be an ad that goes nowhere.
              linkUrl: landing || undefined,
              callToAction: 'LEARN_MORE'
            }))
            .filter((_, i) => !!(vHeadlines[i]?.trim() || vImages[i]?.trim()));

    // Zernio rejects the two together: `creatives[]` builds N ads, `placementAssets` customises
    // ONE. Say so here rather than let the platform 400 after the user has approved a spend.
    const storyImageUrl = url('storyImageUrl');
    if (storyImageUrl && variants.length) return fail(400, { error: 'variants_or_story_image' });

    const result = await proposeStandalone(event.locals.supabase, brand, {
      platform,
      name,
      goal: (str('goal') || 'traffic') as AdGoal,
      budgetAmount: Number.isFinite(budgetAmount) ? budgetAmount : 25,
      campaignType,
      adAccountId: str('adAccountId') || undefined,
      // A date input gives YYYY-MM-DD; the platforms want an instant. End of that day, so "ends
      // the 30th" means the 30th is included.
      schedule: str('endDate') ? { endDate: `${str('endDate')}T23:59:59Z` } : undefined,
      // proposeStandalone merges this over the brand defaults, so omitted fields keep them.
      targeting: {
        ...(keywords.length ? { keywords } : {}),
        ...(countries.length ? { countries } : {}),
        ...(Number.isFinite(ageMin) && ageMin > 0 ? { age_min: ageMin } : {}),
        ...(Number.isFinite(ageMax) && ageMax > 0 ? { age_max: ageMax } : {})
      },
      creative: {
        headline,
        headlines: [headline, ...list('additionalHeadlines')],
        body: str('body') || undefined,
        descriptions: [str('body'), ...list('additionalDescriptions')].filter(Boolean),
        imageUrl: url('imageUrl') || undefined,
        squareImageUrl: url('squareImageUrl') || undefined,
        storyImageUrl: storyImageUrl || undefined,
        businessName: str('businessName') || brand.name.slice(0, 25),
        landingPageUrl: landing || undefined,
        linkUrl: landing || undefined,
        callToAction: 'LEARN_MORE',
        variants: variants.length ? variants : undefined
      }
    });
    if (!result.ok) return fail(400, { error: result.error });
    return { created: result.id };
  };
}

// ── /ads/{channel}/new — one page whose only job is creating a campaign ────────────

export function isAdsChannel(v: string | undefined): v is AdsChannel {
  return v === 'social' || v === 'google';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adsNewLoad = async ({
  parent,
  params,
  locals: { supabase, safeGetSession }
}: ServerLoadEvent<any, any>) => {
  const channel = params.channel;
  if (!isAdsChannel(channel)) throw error(404, 'Not found');
  const { brand } = (await parent()) as { brand: AdsBrand };
  const { user } = await safeGetSession();
  const email = user?.email ?? null;
  if (!adsFeatureEnabled(email)) throw error(404, 'Not found');
  // No new-campaign form until self-serve — send them back to the book-a-call placeholder.
  if (!adsSelfServeEnabled(isAdsPreviewUser(email))) throw redirect(303, `/app/${brand.slug}/ads/${channel}`);
  if (!adsAvailable(brand.plan, email)) throw redirect(303, `/app/${brand.slug}/settings/ads`);

  const readiness = await adsReadiness(supabase, { ...brand, actorEmail: email }, channel);
  return { channel, readiness, website: brand.website, selfServe: true };
};

export const adsNewActions: Actions = {
  // Write the whole campaign with AI. Costs AI credits like any other generation; it does NOT
  // touch the ad platform and cannot spend ad money — approving the proposal is a separate step.
  generate: async (event) => {
    const email = await actorEmail(event);
    if (!adsSelfServeEnabled(isAdsPreviewUser(email))) return refuseUntilSelfServe();
    const channel = event.params.channel;
    if (!isAdsChannel(channel)) return fail(404, { error: 'not_found' });
    const brand = await loadBrand(event.locals.supabase, event.params.brand!, email);
    if (!brand || !adsAvailable(brand.plan, email)) return fail(403, { error: 'ads_not_on_plan' });

    const fd = await event.request.formData();
    const campaignTypeRaw = String(fd.get('campaignType') ?? '').toUpperCase();
    const budget = Number(fd.get('budgetAmount'));

    try {
      const draft = await withBrandContext(brand.id, () =>
        generateCampaignDraft(event.locals.supabase, brand, {
          channel,
          campaignType: campaignTypeRaw === 'DISPLAY' ? 'DISPLAY' : 'SEARCH',
          brief: String(fd.get('brief') ?? '').trim() || undefined,
          budgetAmount: Number.isFinite(budget) && budget > 0 ? budget : undefined,
          landingUrl: String(fd.get('landingPageUrl') ?? '').trim() || undefined
        })
      );
      return { draft };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(400, { error: msg });
    }
  },

  create: async (event) => {
    const channel = event.params.channel;
    if (!isAdsChannel(channel)) return fail(404, { error: 'not_found' });
    return adsCreateAction(channel)(event);
  }
};
