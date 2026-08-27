import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand, brandId, flags } = await parent();
  if (!flags?.designStudio) throw error(404, 'Design Studio is not enabled');

  const { data: kit } = await supabase
    .from('brand_kit')
    .select('fonts, brand_colors')
    .eq('brand_id', brandId)
    .maybeSingle();

  // A real image for the photo-overlay template: the newest generated post media. Public bucket
  // URL, so ImageLayer is exercised against the same kind of src a real design doc will carry.
  // Null is fine — the template falls back to a transparent pixel.
  const { data: recent } = await supabase
    .from('posts')
    .select('media_url')
    .eq('brand_id', brandId)
    .not('media_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    brandName: brand.name as string,
    fonts: kit?.fonts ?? [],
    brandColors: kit?.brand_colors ?? [],
    sampleImageUrl: (recent?.media_url as string | null) ?? null
  };
};
