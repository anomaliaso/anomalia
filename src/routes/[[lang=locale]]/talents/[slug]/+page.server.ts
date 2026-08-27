import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { getTalent, listTalents, TALENT_GUEST_PREVIEW } from '$lib/server/talent';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent, url }) => {
  const { session } = await parent();
  const admin = createAdminClient();

  // Guests may only open the first N preview talents; the rest require an account.
  if (!session) {
    const all = await listTalents(admin);
    const allowed = new Set(all.slice(0, TALENT_GUEST_PREVIEW).map((t) => t.slug));
    if (!allowed.has(params.slug)) {
      const next = encodeURIComponent(url.pathname);
      throw redirect(303, `/login?next=onboarding&mode=signup&return=${next}`);
    }
  }

  const talent = await getTalent(admin, params.slug);
  if (!talent) error(404, 'Talent not found');
  return { talent, gated: !session };
};
