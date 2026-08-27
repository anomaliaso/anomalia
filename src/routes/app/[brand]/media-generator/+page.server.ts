import type { PageServerLoad } from './$types';
import {
  listMediaGeneratorItems,
  listMediaGeneratorPrompts,
  MEDIA_GENERATOR_PAGE_SIZE
} from '$lib/server/media-generator/persist';

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand } = await parent();
  const [page, prompts] = await Promise.all([
    listMediaGeneratorItems(supabase, brand.id, { limit: MEDIA_GENERATOR_PAGE_SIZE }),
    listMediaGeneratorPrompts(supabase, brand.id, { limit: 80 })
  ]);
  return {
    brand,
    items: page.items,
    hasMore: page.hasMore,
    pageSize: MEDIA_GENERATOR_PAGE_SIZE,
    prompts
  };
};
