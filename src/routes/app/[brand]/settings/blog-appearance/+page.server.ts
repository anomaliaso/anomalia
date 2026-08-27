import type { PageServerLoad, Actions } from './$types';
import {
  loadBlogSettingsData,
  saveCustomization,
  uploadIcon,
  removeIcon
} from '$lib/server/blog-settings';

export const load: PageServerLoad = async ({ parent, url, locals: { supabase } }) => {
  const { brand } = await parent();
  return loadBlogSettingsData(brand, url, supabase);
};

export const actions: Actions = {
  saveCustomization,
  uploadIcon,
  removeIcon
};
