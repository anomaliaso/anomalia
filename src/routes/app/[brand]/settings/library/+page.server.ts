import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { crawlBrandSite } from '$lib/server/content-library';
import { setWebsite } from '$lib/server/settings-actions';

// Content Library — brand site pages crawled from the sitemap and AI-scored.
// Crawl fetches up to 80 pages at ~2 req/s plus one AI enrichment call.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { brand } = await parent();
	const { data: pages } = await supabase
		.from('brand_pages')
		.select('url, title, description, topics, relevance_score, last_used_at, last_scanned_at')
		.eq('brand_id', brand.id)
		.eq('active', true)
		.order('relevance_score', { ascending: false, nullsFirst: false })
		.order('last_used_at', { ascending: true, nullsFirst: true });
	return { pages: pages ?? [], brandWebsite: brand.website ?? null };
};

export const actions: Actions = {
	setWebsite,
	scan: async ({ params, locals: { supabase } }) => {
		const { data: brand } = await supabase
			.from('brands')
			.select('id, website, plan')
			.eq('slug', params.brand)
			.maybeSingle();
		if (!brand) return fail(404, { error: 'Brand not found' });
		try {
			const scanned = await crawlBrandSite(createAdminClient(), {
				id: brand.id,
				website: brand.website
			});
			return { scanned };
		} catch (e) {
			return fail(500, { error: e instanceof Error ? e.message : 'scan failed' });
		}
	}
};
