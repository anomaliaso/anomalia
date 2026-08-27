import type { PageServerLoad } from './$types';
import { getPublishingSettings } from '$lib/server/publishing-settings';

// Read-only: the publishing policy is fixed in code (see publishing-settings.ts), so this page
// states it and lists the accounts an approved post can go to. There is no action to save.
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand } = await parent();
  return getPublishingSettings(supabase, brand.id);
};
