import { swallow } from '$lib/server/swallow';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  companyMetaAdLibrary,
  searchMetaAdLibrary,
  metaAdLibraryUrl,
  type MetaAdDigestItem
} from '$lib/server/meta-ad-library';
import {
  digestToNormalizedAd,
  listAdsRemixBriefs,
  produceRemixBrief,
  remixAdsPool,
  REMIX_MAX_POOL,
  type RemixBrief
} from '$lib/server/ads-remix';
import { withBrandContext } from '$lib/server/ai-log';
import { adsAvailable, adsFeatureEnabled } from '$lib/server/ads';
import { gateCredits, CreditsExhaustedError } from '$lib/server/credits';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export type LibraryAd = MetaAdDigestItem & { libraryUrl: string };

type MediaFilter = 'ALL' | 'VIDEO' | 'IMAGE';
type StatusFilter = 'ACTIVE' | 'ALL';
type SearchMode = 'company' | 'query';

function parseMode(raw: string | null): SearchMode {
  return raw === 'query' ? 'query' : 'company';
}

function parseStatus(raw: string | null): StatusFilter {
  return raw === 'ALL' ? 'ALL' : 'ACTIVE';
}

function parseMedia(raw: string | null): MediaFilter {
  if (raw === 'IMAGE' || raw === 'VIDEO' || raw === 'ALL') return raw;
  return 'ALL';
}

function parseAdsPayload(raw: FormDataEntryValue | null): LibraryAd[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        const id = String(r.id ?? '').trim();
        if (!id) return null;
        return {
          id,
          pageName: String(r.pageName ?? ''),
          body: String(r.body ?? ''),
          title: String(r.title ?? ''),
          ctaText: String(r.ctaText ?? ''),
          linkUrl: String(r.linkUrl ?? ''),
          isActive: typeof r.isActive === 'boolean' ? r.isActive : null,
          startDate: r.startDate != null ? String(r.startDate) : null,
          platforms: Array.isArray(r.platforms) ? r.platforms.map((p) => String(p)) : [],
          mediaType: r.mediaType != null ? String(r.mediaType) : null,
          imageUrl: r.imageUrl != null ? String(r.imageUrl) : null,
          videoUrl: r.videoUrl != null ? String(r.videoUrl) : null,
          libraryUrl: String(r.libraryUrl ?? metaAdLibraryUrl(id))
        } satisfies LibraryAd;
      })
      .filter((a): a is LibraryAd => !!a);
  } catch {
    return [];
  }
}

export const load: PageServerLoad = async ({ parent, url, locals: { supabase } }) => {
  const { brand } = await parent();

  const mode = parseMode(url.searchParams.get('mode'));
  const q = String(url.searchParams.get('q') ?? '').trim();
  const status = parseStatus(url.searchParams.get('status'));
  const mediaType = parseMedia(url.searchParams.get('media'));

  const [{ data: competitorRows }, briefs] = await Promise.all([
    supabase
      .from('competitors')
      .select('name')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: true })
      .limit(24),
    listAdsRemixBriefs(supabase, brand.id).catch((error) => { swallow('load remix briefs', error); return [] as RemixBrief[]; })
  ]);

  const competitors = (competitorRows ?? [])
    .map((r) => String(r.name ?? '').trim())
    .filter(Boolean);

  let ads: LibraryAd[] = [];
  let error: string | null = null;

  if (q) {
    try {
      const fetched = await withBrandContext(brand.id, async () => {
        if (mode === 'query') {
          return searchMetaAdLibrary(q, {
            status,
            mediaType,
            limit: 24,
            sortBy: 'total_impressions'
          });
        }
        return companyMetaAdLibrary({
          companyName: q,
          status,
          mediaType,
          limit: 24,
          sortBy: 'total_impressions'
        });
      });
      ads = fetched.map((a) => ({ ...a, libraryUrl: metaAdLibraryUrl(a.id) }));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    brand: { id: brand.id, slug: brand.slug, name: brand.name, plan: brand.plan },
    competitors,
    ads,
    briefs,
    canRemix: adsFeatureEnabled() && adsAvailable(brand.plan),
    error,
    query: {
      q,
      mode,
      status,
      media: mediaType
    }
  };
};

async function loadActionBrand(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  slug: string
) {
  const { data } = await supabase
    .from('brands')
    .select('id, name, slug, plan')
    .eq('slug', slug)
    .maybeSingle();
  return data;
}

export const actions: Actions = {
  // Manda in produzione un brief: coda designer UGC con SOLO materiale del cliente (prodotti,
  // persone, suoi video). Del video del competitor resta solo il testo dentro visual_prompt.
  produce: async ({ request, params, url, locals: { supabase, safeGetSession } }) => {
    const brand = await loadActionBrand(supabase, params.brand!);
    if (!brand) return fail(404, { error: 'Brand not found' });
    if (!adsFeatureEnabled()) return fail(404, { error: 'Not found' });
    if (!adsAvailable(brand.plan)) return fail(403, { error: 'ads_not_on_plan' });

    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'unauthorized' });

    try {
      await gateCredits(brand.id);
    } catch (e) {
      if (e instanceof CreditsExhaustedError) return fail(402, { error: 'credits_exhausted' });
      throw e;
    }

    const fd = await request.formData();
    const briefId = String(fd.get('briefId') ?? '').trim();
    if (!briefId) return fail(400, { error: 'brief_not_found' });

    const result = await withBrandContext(brand.id, () =>
      produceRemixBrief(supabase, {
        brandId: brand.id,
        userId: user.id,
        briefId,
        origin: url.origin
      })
    );
    if (!result.ok) return fail(400, { error: result.error });
    return { produced: true };
  },

  remix: async ({ request, params, locals: { supabase } }) => {
    // Form actions get RequestEvent — no `parent()`. Load the brand like settings/ads.
    const brand = await loadActionBrand(supabase, params.brand!);
    if (!brand) return fail(404, { error: 'Brand not found' });
    if (!adsFeatureEnabled()) return fail(404, { error: 'Not found' });
    if (!adsAvailable(brand.plan)) return fail(403, { error: 'ads_not_on_plan' });

    try {
      await gateCredits(brand.id);
    } catch (e) {
      if (e instanceof CreditsExhaustedError) return fail(402, { error: 'credits_exhausted' });
      throw e;
    }

    const fd = await request.formData();
    const selected = parseAdsPayload(fd.get('ads'));
    if (!selected.length) return fail(400, { error: 'no_ads_selected' });

    const pool = selected.slice(0, REMIX_MAX_POOL).map(digestToNormalizedAd);
    try {
      const result = await withBrandContext(brand.id, () =>
        remixAdsPool(supabase, { id: brand.id, name: brand.name }, pool)
      );
      if (!result.ok) return fail(400, { error: result.error });
      return { remixed: true, count: result.briefs.length };
    } catch (e) {
      console.error('[ads/library remix]', e);
      return fail(500, {
        error: e instanceof Error ? e.message : 'remix_failed'
      });
    }
  }
};
