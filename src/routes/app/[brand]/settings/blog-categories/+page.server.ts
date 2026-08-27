import type { PageServerLoad, Actions } from './$types';
import {
  loadBlogSettingsData,
  createCategory,
  deleteCategory,
  createTag,
  deleteTag
} from '$lib/server/blog-settings';

export const load: PageServerLoad = async ({ parent, url, locals: { supabase } }) => {
  const { brand } = await parent();
  return loadBlogSettingsData(brand, url, supabase);
};

export const actions: Actions = {
  createCategory,
  deleteCategory,
  createTag,
  deleteTag
};
