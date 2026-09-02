import { redirect } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) throw redirect(303, '/login');

  // Approvato (o admin) va nel prodotto: questa pagina esiste solo per chi non lo è ancora.
  if (await canEnter(supabase)) throw redirect(303, '/app');

  // Registrarsi vale come mettersi in coda: si inserisce una volta, le visite dopo non fanno nulla.
  // ignoreDuplicates → INSERT ... ON CONFLICT DO NOTHING (nessun UPDATE, basta la policy di insert).
  await supabase
    .from('waitlist')
    .upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();

  return { email: user.email ?? '', fullName: profile?.full_name ?? '' };
};
