import { redirect } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) throw redirect(303, '/login');

  // Admins go to the real product, not the waitlist.
  if (await canEnter(supabase)) throw redirect(303, '/app');

  // Login == joining the waitlist: insert once, do nothing on repeat visits.
  // ignoreDuplicates → INSERT ... ON CONFLICT DO NOTHING (no UPDATE, so RLS insert policy suffices).
  await supabase
    .from('waitlist')
    .upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });

  const { data: ahead } = await supabase.rpc('waitlist_position');
  return { email: user.email, ahead: ahead ?? 99 };
};
