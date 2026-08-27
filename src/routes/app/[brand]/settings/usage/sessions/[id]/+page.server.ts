import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAgentSession } from '$lib/server/cli-queries';

export const load: PageServerLoad = async ({ parent, params, locals: { supabase } }) => {
  const { brand } = await parent();
  const session = await getAgentSession(supabase, brand.id, params.id);
  if (!session) throw error(404, 'Session not found');
  return { session };
};
