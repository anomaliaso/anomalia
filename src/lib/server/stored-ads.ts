import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signKnowledgePaths } from '$lib/server/media-archive';

export type StoredAdDraft = {
	id: string;
	pageName: string;
	body: string | null;
	thumb: string | null;
	libraryUrl: string | null;
};

export type StoredAdRef = {
	id: string;
	pageName: string;
	body: string | null;
	thumbnailUrl: string;
	libraryUrl: string | null;
};

const MAX_STORED_ADS = 48;

function str(v: unknown, max: number): string {
	return String(v ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}

/** Normalize a competitor/market/remix JSON row into a draft (thumb may still be a storage path). */
export function storedAdFromUnknown(raw: unknown): StoredAdDraft | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const id = str(
		r.adArchiveId ?? r.ad_archive_id ?? r.sourceAdId ?? r.source_ad_id ?? r.id,
		80
	);
	if (!id) return null;
	const pageName =
		str(r.pageName ?? r.page_name ?? r.sourcePageName ?? r.source_page_name, 120) || 'Ad';
	const bodyRaw = r.body ?? r.sourceBody ?? r.source_body;
	const body = typeof bodyRaw === 'string' && bodyRaw.trim() ? str(bodyRaw, 400) : null;
	const thumb =
		str(
			r.archivedPath ??
				r.archived_path ??
				r.thumbnailUrl ??
				r.thumbnail_url ??
				r.sourceThumbnail ??
				r.source_thumbnail ??
				r.imageUrl ??
				r.image_url,
			2000
		) || null;
	const libraryUrl =
		str(r.libraryUrl ?? r.library_url ?? r.sourceLibraryUrl ?? r.source_library_url, 400) || null;
	return { id, pageName, body, thumb, libraryUrl };
}

export function mergeStoredAdDrafts(groups: unknown[][]): StoredAdDraft[] {
	const seen = new Set<string>();
	const out: StoredAdDraft[] = [];
	for (const group of groups) {
		for (const row of group) {
			const d = storedAdFromUnknown(row);
			if (!d || seen.has(d.id)) continue;
			seen.add(d.id);
			out.push(d);
		}
	}
	return out;
}

function isHttpUrl(v: string): boolean {
	return /^https?:\/\//i.test(v);
}

/**
 * Ads already harvested for this brand: competitor top_ads, weekly market snapshot,
 * and remix-brief sources. No live Meta pull.
 */
export async function listStoredAdRefs(
	supabase: SupabaseClient,
	brandId: string
): Promise<StoredAdRef[]> {
	const [compsRes, marketRes, briefsRes] = await Promise.all([
		supabase.from('competitors').select('top_ads').eq('brand_id', brandId),
		supabase.from('brand_market_references').select('ads').eq('brand_id', brandId).maybeSingle(),
		supabase
			.from('ads_remix_briefs')
			.select('source_ad_id, source_page_name, source_body, source_thumbnail, source_library_url')
			.eq('brand_id', brandId)
			.order('rank', { ascending: true })
	]);

	const competitorAds = (compsRes.data ?? []).flatMap((c) =>
		Array.isArray(c.top_ads) ? (c.top_ads as unknown[]) : []
	);
	const marketAds = Array.isArray(marketRes.data?.ads) ? (marketRes.data.ads as unknown[]) : [];
	const drafts = mergeStoredAdDrafts([competitorAds, marketAds, briefsRes.data ?? []]);

	const paths = drafts
		.map((d) => d.thumb)
		.filter((t): t is string => !!t && !isHttpUrl(t) && !t.startsWith('data:'));
	const signed = await signKnowledgePaths(supabase, paths).catch((error) => { swallow('sign media urls', error); return new Map<string, string>(); });

	const out: StoredAdRef[] = [];
	for (const d of drafts) {
		if (!d.thumb) continue;
		const thumbnailUrl = isHttpUrl(d.thumb) ? d.thumb : (signed.get(d.thumb) ?? null);
		if (!thumbnailUrl) continue;
		out.push({
			id: d.id,
			pageName: d.pageName,
			body: d.body,
			thumbnailUrl,
			libraryUrl: d.libraryUrl
		});
		if (out.length >= MAX_STORED_ADS) break;
	}
	return out;
}
