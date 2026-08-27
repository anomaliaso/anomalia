import type { SupabaseClient } from '@supabase/supabase-js';
import { slugWithRandomTail } from '$lib/brand-slug';

export const SLUG_CONSTRAINT = 'brands_slug_key';
const SLUG_ATTEMPTS = 4;

export type BrandInsertResult = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  error: string | null;
};

function slugConflict(error: { message?: string; details?: string; code?: string } | null): boolean {
  if (!error) return false;
  const blob = `${error.message ?? ''} ${error.details ?? ''}`;
  return blob.includes(SLUG_CONSTRAINT);
}

export async function insertBrandWithSlug(
  supabase: SupabaseClient,
  values: Record<string, unknown>,
  select = 'id, slug, timezone'
): Promise<BrandInsertResult> {
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? (values.slug as string) : slugWithRandomTail(values.slug as string);
    const { data, error } = await supabase
      .from('brands')
      .insert({ ...values, slug })
      .select(select)
      .single();
    if (!error) return { data, error: null };
    if (!slugConflict(error)) return { data: null, error: error.message };
    // Stesso org, stesso slug: un tentativo precedente ha già inserito (timeout, doppio submit).
    // Si RIPRENDE quella riga — non se ne crea una seconda con un tail, e non si abortisce.
    // Un altro org che possiede lo slug non passa il filtro org_id (né l'RLS): si ritenta col tail.
    const orgId = typeof values.org_id === 'string' ? values.org_id : '';
    if (orgId) {
      const { data: mine } = await supabase
        .from('brands')
        .select(select)
        .eq('org_id', orgId)
        .eq('slug', slug)
        .maybeSingle();
      if (mine) return { data: mine, error: null };
    }
  }
  return { data: null, error: 'Could not pick a free URL for this workspace' };
}
