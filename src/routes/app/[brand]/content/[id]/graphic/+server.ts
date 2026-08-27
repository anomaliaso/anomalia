import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { GRAPHIC_SOURCE_MAX_CHARS, unwrapGraphicSource } from '$lib/design/graphic-source';
import { latestGraphic, versionSource } from '$lib/server/design-store';
import { applyPostGraphicSource, loadEditorContext } from '$lib/server/chat/post-editor-tools';
import { pngToJpeg, renderGraphicSource } from '$lib/server/design-render';
import { isVideoPostRow } from '$lib/server/media-origin';

export const GET: RequestHandler = async ({ params, url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
	if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

	const { data: post } = await supabase
		.from('posts')
		.select('id, content_type, media_url, media_urls')
		.eq('id', params.id)
		.eq('brand_id', brand.id)
		.maybeSingle();
	if (!post) return json({ error: 'Post not found' }, { status: 404 });

	const slideRaw = url.searchParams.get('slide');
	const slideIndex =
		slideRaw != null && slideRaw !== '' && Number.isInteger(Number(slideRaw)) ? Number(slideRaw) : null;

	const graphic = await latestGraphic(supabase, {
		kind: 'post',
		id: post.id,
		slideIndex
	});
	if (!graphic) return json({ error: 'No graphic' }, { status: 404 });

	return json({
		source: versionSource(graphic),
		kind: graphic.sourceKind,
		aspect: graphic.aspect,
		version: graphic.version,
		media_url: graphic.mediaUrl
	});
};

export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession } }) => {
	const { session, user } = await safeGetSession();
	if (!session || !user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!(await canEnter(supabase))) return json({ error: 'Forbidden' }, { status: 403 });

	const { data: brand } = await supabase
		.from('brands')
		.select('id, timezone')
		.eq('slug', params.brand)
		.maybeSingle();
	if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

	const { data: post } = await supabase
		.from('posts')
		.select('id, content_type, format, media_url, media_urls')
		.eq('id', params.id)
		.eq('brand_id', brand.id)
		.maybeSingle();
	if (!post) return json({ error: 'Post not found' }, { status: 404 });
	if (isVideoPostRow(post)) {
		return json({ error: 'Cannot replace a video with a still graphic from the source editor.' }, { status: 400 });
	}

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const source = unwrapGraphicSource(typeof body.source === 'string' ? body.source : '');
	if (!source) return json({ error: 'Empty source' }, { status: 400 });
	if (source.length > GRAPHIC_SOURCE_MAX_CHARS) {
		return json({ error: `Source exceeds ${GRAPHIC_SOURCE_MAX_CHARS} characters` }, { status: 400 });
	}

	const format = body.format === 'jpeg' || body.format === 'jpg' ? 'jpeg' : 'png';
	const exportOnly = body.export === true;
	const slideIndex =
		typeof body.slide_index === 'number' && Number.isInteger(body.slide_index) ? body.slide_index : null;

	const ctx = await loadEditorContext(supabase, brand.id);

	if (exportOnly) {
		let out;
		try {
			out = await renderGraphicSource(source, {
				brandColors: ctx.brandColors,
				typography: { display: ctx.typography.display, body: ctx.typography.body },
				format
			});
		} catch (e) {
			return json({ error: e instanceof Error ? e.message : 'Render failed' }, { status: 400 });
		}
		const bytes = format === 'jpeg' ? (out.jpeg ?? (await pngToJpeg(out.png))) : out.png;
		const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
		return json({
			ok: true,
			mime,
			data: bytes.toString('base64'),
			width: out.width,
			height: out.height,
			kind: out.sourceKind
		});
	}

	const saved = await applyPostGraphicSource(
		{
			supabase,
			brandId: brand.id,
			postId: post.id,
			tz: brand.timezone ?? 'Europe/Rome',
			userId: user.id,
			ctx,
			refUrls: []
		},
		{ source, slide_index: slideIndex, format, brief: 'source editor' }
	);
	if ('error' in saved) return json({ error: saved.error }, { status: 400 });

	return json({
		ok: true,
		media_url: saved.media_url,
		version: saved.version,
		source: saved.graphic_source,
		kind: saved.source_kind,
		width: saved.width,
		height: saved.height
	});
};
