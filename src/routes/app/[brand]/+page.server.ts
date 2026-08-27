import type { Actions, PageServerLoad } from './$types';
import { saveOnboardingState } from '$lib/server/onboarding';

/**
 * La home del brand è solo la chat: niente workbench sotto, quindi niente
 * `loadHomeOverview` qui. Quelle ~30 query vivono ora in `workbench/+page.server.ts`
 * e partono soltanto quando il workbench viene aperto davvero (modal o pagina piena).
 * Restano solo i campi che il guscio legge: nessun await lungo prima del primo pixel.
 */
export const load: PageServerLoad = async ({ parent }) => {
  const { brand } = await parent();
  return { timezone: brand.timezone ?? 'Europe/Rome' };
};

export const actions: Actions = {
  skipOnboarding: async ({ params, locals: { supabase } }) => {
    const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
    if (brand) await saveOnboardingState(supabase, brand.id, { status: 'paused' });
    return { paused: true };
  },

  resumeOnboarding: async ({ params, locals: { supabase } }) => {
    const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
    if (brand) await saveOnboardingState(supabase, brand.id, { status: 'in_progress' });
    return { resumed: true };
  }
};
