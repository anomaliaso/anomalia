import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const EXTS: Record<string, string> = {
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm'
};

/**
 * Signed upload URL for a reference clip the user attaches to any agent.
 * A video never fits in a request body (Vercel rejects it as FUNCTION_PAYLOAD_TOO_LARGE), so the
 * browser puts it in Storage directly and the agent turn only carries the resulting public URL.
 */
export const GET: RequestHandler = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const ext = url.searchParams.get('ext') ?? 'mp4';
	const contentType = EXTS[ext];
	if (!contentType) throw error(400, 'Unsupported extension');

	const path = `${user.id}/chat-refs/${crypto.randomUUID()}.${ext}`;
	const { data, error: signErr } = await supabase.storage.from('media').createSignedUploadUrl(path);
	if (signErr || !data) {
		console.error('[upload-url] sign', signErr?.message);
		throw error(500, 'Sign failed');
	}

	return json({
		uploadPath: data.path,
		uploadToken: data.token,
		contentType,
		publicUrl: supabase.storage.from('media').getPublicUrl(path).data.publicUrl
	});
};
