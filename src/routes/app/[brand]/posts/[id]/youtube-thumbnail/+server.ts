import { json } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { remaining } from '$lib/server/usage';
import { youtubeTitleFrom } from '$lib/platform-limits';
import {
	YOUTUBE_THUMBNAIL_SOURCE_MAX_BYTES,
	copyImageAsYoutubeThumbnail,
	generateYoutubeThumbnail,
	persistYoutubeThumbnail,
	uploadYoutubeThumbnailBytes
} from '$lib/server/youtube-thumbnail';
import { isYoutubeThumbnailSource } from '$lib/youtube-thumbnail-format';
import type { RequestHandler } from './$types';

// Image render + optional library fetch — same headroom as post regenerate.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

const POST_COLS = 'id, brand_id, caption, title, video_thumbnail_url, youtube_thumbnail_url, platform, platforms';

export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
	const { session, user } = await safeGetSession();
	if (!session || !user) return new Response('Unauthorized', { status: 401 });
	if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

	const { data: brand } = await supabase
		.from('brands')
		.select('id, plan, timezone')
		.eq('slug', params.brand)
		.maybeSingle();
	if (!brand) return json({ error: 'brand_not_found' }, { status: 404 });

	const { data: post } = await supabase
		.from('posts')
		.select(POST_COLS)
		.eq('id', params.id)
		.eq('brand_id', brand.id)
		.maybeSingle();
	if (!post) return json({ error: 'Post not found' }, { status: 404 });

	const save = async (url: string | null) => {
		const r = await persistYoutubeThumbnail(supabase, { postId: post.id, brandId: brand.id, url });
		if (r.error) return json({ error: r.error }, { status: 500 });
		return json({ ok: true, youtube_thumbnail_url: url });
	};

	const ct = request.headers.get('content-type') ?? '';
	if (ct.includes('multipart/form-data')) {
		const form = await request.formData().catch(() => null);
		const file = form?.get('file');
		if (!(file instanceof File) || file.size === 0) return json({ error: 'no_file' }, { status: 400 });
		if (!isYoutubeThumbnailSource({ mime: file.type, filename: file.name })) {
			return json({ error: 'not_image' }, { status: 400 });
		}
		if (file.size > YOUTUBE_THUMBNAIL_SOURCE_MAX_BYTES) return json({ error: 'too_large' }, { status: 400 });
		const uploaded = await uploadYoutubeThumbnailBytes(
			supabase,
			user.id,
			Buffer.from(await file.arrayBuffer()),
			file.type,
			file.name
		);
		if ('error' in uploaded) {
			const status = uploaded.error === 'upload_failed' ? 502 : 400;
			return json({ error: uploaded.error }, { status });
		}
		return save(uploaded.url);
	}

	const body = (await request.json().catch(() => ({}))) as {
		action?: string;
		brief?: string;
		caption?: string;
		title?: string;
		url?: string;
	};
	const action = String(body.action ?? '');

	if (action === 'clear') return save(null);

	if (action === 'use_cover') {
		const cover = String(post.video_thumbnail_url ?? '').trim();
		if (!cover) return json({ error: 'no_cover' }, { status: 400 });
		const url = await copyImageAsYoutubeThumbnail(supabase, user.id, cover);
		if (!url) return json({ error: 'copy_failed' }, { status: 502 });
		return save(url);
	}

	if (action === 'set') {
		const src = String(body.url ?? '').trim();
		if (!src) return json({ error: 'missing_url' }, { status: 400 });
		const url = await copyImageAsYoutubeThumbnail(supabase, user.id, src);
		if (!url) return json({ error: 'copy_failed' }, { status: 502 });
		return save(url);
	}

	if (action === 'generate') {
		const budget = await remaining(supabase, brand.id, brand.plan, brand.timezone ?? 'Europe/Rome');
		if (budget.credits.remaining <= 0) {
			return json(
				{
					error: 'credits_exhausted',
					resetDate: budget.credits.periodEnd.toISOString(),
					quota: budget.credits.quota,
					used: budget.credits.used
				},
				{ status: 402 }
			);
		}
		const caption = typeof body.caption === 'string' ? body.caption : (post.caption as string | null);
		const title = youtubeTitleFrom(caption, typeof body.title === 'string' ? body.title : post.title);
		const cover = String(post.video_thumbnail_url ?? '').trim();
		const gen = await generateYoutubeThumbnail({
			supabase,
			userId: user.id,
			brandId: brand.id,
			title,
			caption,
			brief: typeof body.brief === 'string' ? body.brief : '',
			referenceUrls: cover ? [cover] : []
		});
		if (!gen.imageUrl) return json({ error: gen.error ?? 'generate_failed' }, { status: 502 });
		return save(gen.imageUrl);
	}

	return json({ error: 'bad_action' }, { status: 400 });
};
