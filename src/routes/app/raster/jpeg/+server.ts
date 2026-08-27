import { json } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { RASTER_SOURCE_MAX_BYTES } from '$lib/raster-image';
import { rasterToJpeg } from '$lib/server/raster-image';
import type { RequestHandler } from './$types';

/** Decode HEIC (and any other raster) to JPEG for browsers that cannot read iPhone photos. */
export const POST: RequestHandler = async ({ request, locals: { safeGetSession, supabase } }) => {
	const { session, user } = await safeGetSession();
	if (!session || !user) return new Response('Unauthorized', { status: 401 });
	if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File) || file.size === 0) return json({ error: 'no_file' }, { status: 400 });
	if (file.size > RASTER_SOURCE_MAX_BYTES) return json({ error: 'too_large' }, { status: 400 });

	const out = await rasterToJpeg(Buffer.from(await file.arrayBuffer()), {
		mime: file.type,
		filename: file.name,
		always: true,
		maxBytes: 12 * 1024 * 1024,
		sourceMaxBytes: RASTER_SOURCE_MAX_BYTES
	});
	if (!out.ok) return json({ error: out.error }, { status: 400 });
	return new Response(new Uint8Array(out.bytes), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }
	});
};
