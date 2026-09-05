// Competitor Meta ads via ScrapeCreators Ad Library.
// Zernio Ads manages *our* campaigns; this module spies public competitor creatives.
import { swallow } from '$lib/server/swallow';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '$lib/server/supabase-admin';
import { archiveImageToBucket } from '$lib/server/media-archive';
import { scrapeCreatorsGet, MEDIA_FRESH_MS } from '$lib/server/scrapecreators';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type NormalizedAd = {
	adArchiveId: string;
	pageName: string;
	pageId: string | null;
	body: string | null;
	cta: string | null;
	linkUrl: string | null;
	platforms: string[];
	displayFormat: string | null;
	thumbnailUrl: string | null;
	startDate: string | null;
	isActive: boolean;
	libraryUrl: string;
	/**
	 * mp4 pubblico dell'annuncio, quando la Ad Library ne espone uno.
	 *
	 * VINCOLO NON NEGOZIABILE: da questo URL esce SOLO TESTO. Vive in memoria giusto il tempo di
	 * `breakdownReferenceVideo` (scarica → fotogrammi → brief) e non viene MAI ri-hostato, né
	 * scritto su `ads_remix_briefs`, né passato a un modello generativo. Entra un mp4, esce un brief.
	 */
	videoUrl?: string | null;
	/** Set when archived into brand-knowledge. */
	archivedPath?: string | null;
	/** Present on brand-level trending snapshots. */
	competitor?: string | null;
};

const CACHE_PLATFORM = 'meta_ad_library';
const MAX_ADS_PER_COMPETITOR = 4;
const MAX_TRENDING_ADS = 8;

function libraryUrl(id: string): string {
	return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
}

function isoFromUnix(s: number | null | undefined): string | null {
	if (s == null || !Number.isFinite(s)) return null;
	return new Date(s > 1e12 ? s : s * 1000).toISOString();
}

function pickThumb(snapshot: AnyRec | null | undefined): string | null {
	if (!snapshot) return null;
	const img = snapshot.images?.[0];
	const fromImg =
		(typeof img?.resized_image_url === 'string' && img.resized_image_url) ||
		(typeof img?.original_image_url === 'string' && img.original_image_url) ||
		null;
	if (fromImg) return fromImg;
	const vid = snapshot.videos?.[0];
	if (typeof vid?.video_preview_image_url === 'string' && vid.video_preview_image_url) {
		return vid.video_preview_image_url;
	}
	const card = snapshot.cards?.[0];
	const fromCard =
		(typeof card?.resized_image_url === 'string' && card.resized_image_url) ||
		(typeof card?.original_image_url === 'string' && card.original_image_url) ||
		(typeof card?.video_preview_image_url === 'string' && card.video_preview_image_url) ||
		null;
	return fromCard;
}

/** Pure mapper — unit-tested. Accepts one Ad Library search/company result row. */
export function mapMetaAd(raw: AnyRec): NormalizedAd | null {
	const id = String(raw?.ad_archive_id ?? '').trim();
	if (!id) return null;
	const snapshot = (raw?.snapshot ?? null) as AnyRec | null;
	const body =
		(typeof snapshot?.body?.text === 'string' && snapshot.body.text) ||
		(typeof snapshot?.body === 'string' && snapshot.body) ||
		(typeof snapshot?.cards?.[0]?.body === 'string' && snapshot.cards[0].body) ||
		null;
	const platforms = Array.isArray(raw?.publisher_platform)
		? raw.publisher_platform.map((p: unknown) => String(p)).filter(Boolean)
		: [];
	return {
		adArchiveId: id,
		pageName: String(raw?.page_name ?? snapshot?.page_name ?? '').trim() || 'Unknown',
		pageId: raw?.page_id != null ? String(raw.page_id) : null,
		body: body ? String(body).slice(0, 800) : null,
		cta: typeof snapshot?.cta_text === 'string' ? snapshot.cta_text : null,
		linkUrl: typeof snapshot?.link_url === 'string' ? snapshot.link_url : null,
		platforms,
		displayFormat: typeof snapshot?.display_format === 'string' ? snapshot.display_format : null,
		thumbnailUrl: pickThumb(snapshot),
		startDate: isoFromUnix(typeof raw?.start_date === 'number' ? raw.start_date : null),
		isActive: raw?.is_active !== false,
		libraryUrl: libraryUrl(id)
	};
}

function cacheHandle(kind: 'company' | 'keyword', key: string): string {
	return `${kind}:${key.trim().toLowerCase().slice(0, 120)}`;
}

async function readCache(handle: string): Promise<NormalizedAd[] | null> {
	const admin = createAdminClient();
	const { data } = await admin
		.from('scrapecreators_cache')
		.select('posts, fetched_at')
		.eq('platform', CACHE_PLATFORM)
		.eq('handle', handle)
		.maybeSingle();
	if (!data) return null;
	const age = Date.now() - new Date(data.fetched_at).getTime();
	if (!Number.isFinite(age) || age < 0 || age >= MEDIA_FRESH_MS) return null;
	return (Array.isArray(data.posts) ? data.posts : []) as NormalizedAd[];
}

async function writeCache(handle: string, ads: NormalizedAd[]): Promise<void> {
	const admin = createAdminClient();
	await admin.from('scrapecreators_cache').upsert(
		{
			platform: CACHE_PLATFORM,
			handle,
			posts: ads,
			post_count: ads.length,
			fetched_at: new Date().toISOString()
		},
		{ onConflict: 'platform,handle' }
	);
}

function mapList(rows: unknown[]): NormalizedAd[] {
	const out: NormalizedAd[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		const ad = mapMetaAd((row ?? {}) as AnyRec);
		if (!ad || seen.has(ad.adArchiveId)) continue;
		seen.add(ad.adArchiveId);
		out.push(ad);
	}
	return out;
}

/** Active Meta ads for a company name (Ad Library company endpoint). Cache 7d. */
export async function fetchCompanyAds(
	companyName: string,
	opts?: { max?: number; country?: string }
): Promise<NormalizedAd[]> {
	const name = companyName.trim();
	if (!name) return [];
	const max = opts?.max ?? MAX_ADS_PER_COMPETITOR;
	const handle = cacheHandle('company', name);
	const cached = await readCache(handle).catch((error) => { swallow('read ads cache', error); return null; });
	if (cached) return cached.slice(0, max);

	const qs = new URLSearchParams({
		companyName: name,
		status: 'ACTIVE',
		media_type: 'ALL',
		sort_by: 'total_impressions',
		trim: 'true'
	});
	if (opts?.country) qs.set('country', opts.country);
	const data = await scrapeCreatorsGet(`/v1/facebook/adLibrary/company/ads?${qs}`);
	const rows = (data?.results ?? data?.searchResults ?? data?.ads ?? []) as unknown[];
	const ads = mapList(Array.isArray(rows) ? rows : []).slice(0, max);
	await writeCache(handle, ads).catch(swallow('write ads cache'));
	return ads;
}

/**
 * Keyword Ad Library search sorted by impressions — approximates "trending in niche".
 * Requires a query (category / niche phrase). Cache 7d.
 */
export async function fetchTrendingAdsByKeyword(
	query: string,
	opts?: { max?: number; country?: string }
): Promise<NormalizedAd[]> {
	const q = query.trim();
	if (!q) return [];
	const max = opts?.max ?? MAX_TRENDING_ADS;
	const handle = cacheHandle('keyword', q);
	const cached = await readCache(handle).catch((error) => { swallow('read ads cache', error); return null; });
	if (cached) return cached.slice(0, max);

	const qs = new URLSearchParams({
		query: q,
		status: 'ACTIVE',
		media_type: 'ALL',
		sort_by: 'total_impressions',
		search_type: 'keyword_unordered',
		ad_type: 'all',
		trim: 'true'
	});
	if (opts?.country) qs.set('country', opts.country);
	const data = await scrapeCreatorsGet(`/v1/facebook/adLibrary/search/ads?${qs}`);
	const rows = (data?.searchResults ?? data?.results ?? data?.ads ?? []) as unknown[];
	const ads = mapList(Array.isArray(rows) ? rows : []).slice(0, max);
	await writeCache(handle, ads).catch(swallow('write ads cache'));
	return ads;
}

async function archiveAdThumbs(
	supabase: SupabaseClient,
	ownerId: string | null,
	brandId: string,
	ads: NormalizedAd[]
): Promise<NormalizedAd[]> {
	if (!ownerId) return ads;
	return Promise.all(
		ads.map(async (ad) => {
			if (!ad.thumbnailUrl) return ad;
			const key = createHash('sha1').update(ad.thumbnailUrl).digest('hex').slice(0, 16);
			const archivedPath = await archiveImageToBucket(
				supabase,
				`${ownerId}/${brandId}/competitors/ads/${key}.jpg`,
				ad.thumbnailUrl
			).catch((error) => { swallow('archive thumbnail', error); return null; });
			return archivedPath ? { ...ad, archivedPath } : ad;
		})
	);
}

/**
 * Refresh Meta ads snapshots for each competitor (+ optional niche keyword trending list).
 * Best-effort: failures per competitor are swallowed so organic refresh still completes.
 */
export async function refreshCompetitorAds(
	supabase: SupabaseClient,
	brandId: string,
	opts: {
		competitors: Array<{ id: string; name: string }>;
		keyword?: string | null;
		ownerId?: string | null;
		country?: string | null;
	}
): Promise<{ perCompetitor: number; trending: NormalizedAd[] }> {
	const country = opts.country?.trim() || undefined;
	let perCompetitor = 0;
	const trendingPool: NormalizedAd[] = [];

	await Promise.all(
		opts.competitors.slice(0, 5).map(async (c) => {
			try {
				let ads = await fetchCompanyAds(c.name, { country, max: MAX_ADS_PER_COMPETITOR });
				ads = await archiveAdThumbs(supabase, opts.ownerId ?? null, brandId, ads);
				await supabase.from('competitors').update({ top_ads: ads }).eq('id', c.id);
				perCompetitor += ads.length;
				for (const ad of ads) trendingPool.push({ ...ad, competitor: c.name });
			} catch (error) { swallow('fetch competitor ads', error); }
		})
	);

	let trending: NormalizedAd[] = [];
	const kw = opts.keyword?.trim();
	if (kw) {
		try {
			let ads = await fetchTrendingAdsByKeyword(kw, { country, max: MAX_TRENDING_ADS });
			ads = await archiveAdThumbs(supabase, opts.ownerId ?? null, brandId, ads);
			trending = ads.map((a) => ({ ...a, competitor: a.pageName }));
		} catch {
			trending = [];
		}
	}
	if (!trending.length && trendingPool.length) {
		trending = trendingPool.slice(0, MAX_TRENDING_ADS);
	}

	return { perCompetitor, trending };
}

