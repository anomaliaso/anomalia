import type { PageServerLoad } from './$types';
import { listMotionVideoPrompts, listMotionVideos } from '$lib/server/motion-video/persist';

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { brand, brandId } = await parent();
	const [videos, prompts] = await Promise.all([
		listMotionVideos(supabase, brandId),
		listMotionVideoPrompts(supabase, brandId, 80)
	]);
	return { brand, videos, prompts };
};
