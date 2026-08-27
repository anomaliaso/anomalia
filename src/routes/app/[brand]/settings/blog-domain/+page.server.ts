import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { hasBlogCustomDomain } from '$lib/server/plans';
import {
  loadBlogSettingsData,
  connectDomain,
  verifyDomain,
  disconnectDomain
} from '$lib/server/blog-settings';

export const load: PageServerLoad = async ({ parent, url, locals: { supabase } }) => {
  const { brand } = await parent();
  // Custom domain is paid-only (any paid tier). Free keeps Anomalia hosting only.
  if (!hasBlogCustomDomain(brand.plan)) {
    throw redirect(303, `/app/${brand.slug}/activate?plan=starter`);
  }
  return loadBlogSettingsData(brand, url, supabase);
};

export const actions: Actions = {
  connectDomain,
  verifyDomain,
  disconnectDomain
};
