import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { listTalents, TALENT_GUEST_PREVIEW, type Talent } from '$lib/server/talent';

function teaserTalent(t: Talent): Talent {
  const face = t.views.find((v) => v.view_key === 'face-front') ?? t.views[0];
  return {
    ...t,
    traits: {},
    views: face ? [{ ...face }] : []
  };
}

export const load: PageServerLoad = async ({ parent }) => {
  const { session } = await parent();
  const admin = createAdminClient();
  const all = await listTalents(admin);
  const gated = !session;

  if (!gated) {
    return {
      talents: all,
      lockedTalents: [] as Talent[],
      gated: false,
      totalCount: all.length,
      previewLimit: TALENT_GUEST_PREVIEW
    };
  }

  return {
    talents: all.slice(0, TALENT_GUEST_PREVIEW),
    lockedTalents: all.slice(TALENT_GUEST_PREVIEW).map(teaserTalent),
    gated: true,
    totalCount: all.length,
    previewLimit: TALENT_GUEST_PREVIEW
  };
};
