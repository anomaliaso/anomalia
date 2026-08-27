import { swallow } from '$lib/server/swallow';
import type { PageServerLoad, Actions } from './$types';
import { studioActions } from '$lib/server/studio-actions';
import { signKnowledgePaths } from '$lib/server/media-archive';
import { loadMarketReferences, FRESH_DAYS } from '$lib/server/market-references';
import type { NormalizedAd } from '$lib/server/competitor-ads';
import { cachedBrandPage } from '$lib/server/page-cache';

export const config = { maxDuration: 300 };

type TopPost = {
	content: string | null;
	platform: string;
	thumbnailUrl: string | null;
	engagement: number;
	metrics: Record<string, unknown>;
	archivedPath?: string | null;
};

type Benchmark = {
	count?: number;
	medianEngagement?: number;
	postsPerWeek?: number;
	formatMix?: { image?: number; video?: number; text?: number };
} | null;

export type CompetitorAd = NormalizedAd & { thumb: string | null };

export type CompetitorRow = {
	id: string;
	name: string;
	website: string | null;
	kind: 'direct' | 'indirect';
	rationale: string | null;
	source: string | null;
	handles: Array<{ platform: string; handle: string }> | null;
	benchmark: Benchmark;
	topPosts: Array<TopPost & { thumb: string | null }>;
	topAds: CompetitorAd[];
};

function normalizeHandles(raw: unknown): CompetitorRow['handles'] {
	if (!Array.isArray(raw)) return null;
	const out: Array<{ platform: string; handle: string }> = [];
	for (const h of raw) {
		if (!h || typeof h !== 'object') continue;
		const rec = h as Record<string, unknown>;
		const platform = String(rec.platform ?? '').trim();
		const handle = String(rec.handle ?? rec.username ?? '')
			.trim()
			.replace(/^@/, '');
		if (!platform || !handle) continue;
		out.push({ platform, handle });
	}
	return out.length ? out : null;
}

function withThumb(ad: NormalizedAd, signed: Map<string, string>): CompetitorAd {
	return {
		...ad,
		thumb:
			(ad.archivedPath && signed.get(String(ad.archivedPath))) ||
			(ad.thumbnailUrl ? String(ad.thumbnailUrl) : null)
	};
}

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
  	const { data } = await supabase
  		.from('competitors')
  		.select('id, name, website, kind, rationale, source, handles, top_posts, top_ads, benchmark, created_at')
  		.eq('brand_id', brand.id)
  		.order('created_at', { ascending: true });

  	const rows = data ?? [];
  	const archivePaths = rows.flatMap((r) => {
  		const posts = (Array.isArray(r.top_posts) ? (r.top_posts as TopPost[]) : [])
  			.map((tp) => String(tp?.archivedPath ?? '').trim())
  			.filter(Boolean);
  		const ads = (Array.isArray(r.top_ads) ? (r.top_ads as NormalizedAd[]) : [])
  			.map((a) => String(a?.archivedPath ?? '').trim())
  			.filter(Boolean);
  		return [...posts, ...ads];
  	});

  	const market = await loadMarketReferences(supabase, brand.id).catch((error) => { swallow('load market references', error); return null; });
  	const marketArchivePaths = [
  		...(market?.references ?? []).map((r) => String(r.archivedPath ?? '').trim()).filter(Boolean),
  		...(market?.ads ?? []).map((a) => String(a.archivedPath ?? '').trim()).filter(Boolean)
  	];

  	const signed =
  		archivePaths.length || marketArchivePaths.length
  			? await signKnowledgePaths(supabase, [...archivePaths, ...marketArchivePaths]).catch((error) => { swallow('sign media urls', error); return new Map<string, string>(); })
  			: new Map<string, string>();

  	const competitors: CompetitorRow[] = rows.map((r) => {
  		const rawPosts = (Array.isArray(r.top_posts) ? r.top_posts : []) as TopPost[];
  		const topPosts = rawPosts.map((tp) => ({
  			...tp,
  			thumb:
  				(tp.archivedPath && signed.get(String(tp.archivedPath))) ||
  				(tp.thumbnailUrl ? String(tp.thumbnailUrl) : null)
  		}));
  		const rawAds = (Array.isArray(r.top_ads) ? r.top_ads : []) as NormalizedAd[];
  		const topAds = rawAds.map((a) => withThumb(a, signed));
  		return {
  			id: r.id as string,
  			name: String(r.name ?? ''),
  			website: r.website ? String(r.website) : null,
  			kind: r.kind === 'indirect' ? 'indirect' : 'direct',
  			rationale: r.rationale ? String(r.rationale) : null,
  			source: r.source ? String(r.source) : null,
  			handles: normalizeHandles(r.handles),
  			benchmark: (r.benchmark as Benchmark) ?? null,
  			topPosts,
  			topAds
  		};
  	});

  	const postsWithThumbs = competitors.reduce((n, c) => n + c.topPosts.filter((p) => p.thumb).length, 0);

  	// Field watch (market-field.ts): i post che girano NEL CAMPO, competitor noti o no, con il
  	// teardown di come comunicano. Vive accanto alle reference dei competitor perché è la stessa
  	// domanda vista dall'altro lato — loro chi conosciamo, questo chi sta funzionando.
  	const { data: fieldLinks } = await supabase
  		.from('brand_field_posts')
  		.select('market_post_id, relevance, discovered_at')
  		.eq('brand_id', brand.id)
  		.order('discovered_at', { ascending: false })
  		.limit(12);
  	const fieldIds = (fieldLinks ?? []).map((l) => l.market_post_id as string);
  	const [{ data: fieldPosts }, { data: fieldTeardowns }] = fieldIds.length
  		? await Promise.all([
  				supabase.from('market_posts').select('id, platform, url, account_key, content, engagement').in('id', fieldIds),
  				supabase
  					.from('market_teardowns')
  					.select('market_post_id, tone_of_voice, format, hook_type, spread_strategy, ragebait, why_it_spread')
  					.in('market_post_id', fieldIds)
  			])
  		: [{ data: [] }, { data: [] }];
  	const fieldPostById = new Map((fieldPosts ?? []).map((p) => [p.id as string, p]));
  	const fieldTeardownById = new Map((fieldTeardowns ?? []).map((t) => [t.market_post_id as string, t]));

  	type FieldPostView = {
  		platform: string;
  		url: string | null;
  		account: string | null;
  		content: string;
  		engagement: number | null;
  		relevance: number | null;
  		tone: string | null;
  		format: string | null;
  		hook: string | null;
  		spread: string[];
  		ragebait: number | null;
  		why: string | null;
  	};

  	const fieldPostViews = (fieldLinks ?? []).map((l): FieldPostView | null => {
  		const post = fieldPostById.get(l.market_post_id as string);
  		if (!post) return null;
  		const t = fieldTeardownById.get(l.market_post_id as string);
  		return {
  			platform: post.platform,
  			url: post.url,
  			account: post.account_key,
  			content: String(post.content ?? '').slice(0, 300),
  			engagement: post.engagement,
  			relevance: l.relevance,
  			tone: t?.tone_of_voice ?? null,
  			format: t?.format ?? null,
  			hook: t?.hook_type ?? null,
  			spread: (t?.spread_strategy ?? []) as string[],
  			ragebait: t?.ragebait ?? null,
  			why: t?.why_it_spread ?? null
  		};
  	});

  	const fieldView = {
  		playbook: market?.field_playbook ?? null,
  		// Il predicato esplicito, non `filter(Boolean)`: quest'ultimo non restringe il tipo e la
  		// pagina si ritroverebbe a fare `p.platform` su un possibile null.
  		posts: fieldPostViews.filter((p): p is FieldPostView => p !== null)
  	};

  	const marketView = market
  		? {
  				summary: market.summary,
  				formats: market.catalog.formats ?? [],
  				hooks: market.catalog.hooks ?? [],
  				angles: market.catalog.angles ?? [],
  				updatedAt: market.updated_at,
  				references: market.references.slice(0, 8).map((r) => ({
  					competitor: r.competitor,
  					platform: r.platform,
  					mediaType: r.mediaType,
  					format: r.format ?? null,
  					hook: r.hook ?? null,
  					content: r.content,
  					engagement: r.engagement,
  					thumb:
  						(r.archivedPath && signed.get(String(r.archivedPath))) ||
  						(r.thumbnailUrl ? String(r.thumbnailUrl) : null)
  				})),
  				ads: (market.ads ?? []).slice(0, 8).map((a) => withThumb(a, signed))
  			}
  		: null;

  	return {
  		competitors,
  		market: marketView,
  		field: fieldView,
  		freshDays: FRESH_DAYS,
  		stats: {
  			count: competitors.length,
  			posts: competitors.reduce((n, c) => n + c.topPosts.length, 0),
  			ads: competitors.reduce((n, c) => n + c.topAds.length, 0),
  			withMedia: postsWithThumbs
  		}
  	};
  });
};

export const actions: Actions = {
	addCompetitor: studioActions.addCompetitor,
	updateCompetitor: studioActions.updateCompetitor,
	deleteCompetitor: studioActions.deleteCompetitor,
	researchCompetitors: studioActions.researchCompetitors,
	refreshMarketReferences: studioActions.refreshMarketReferences,
	refreshField: studioActions.refreshField
};
