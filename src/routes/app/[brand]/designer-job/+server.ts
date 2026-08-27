import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadDesignerJob } from '$lib/server/designer-jobs';

export const GET: RequestHandler = async ({ url, params, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const jobId = url.searchParams.get('id')?.trim();
	if (!jobId) throw error(400, 'Missing id');

	const { data: brand } = await supabase
		.from('brands')
		.select('id')
		.eq('slug', params.brand)
		.maybeSingle();
	if (!brand) throw error(404, 'Brand not found');

	const job = await loadDesignerJob(supabase, {
		jobId,
		userId: user.id,
		brandId: brand.id as string
	});
	if (!job) throw error(404, 'Not found');

	return json({ ok: true, job });
};
