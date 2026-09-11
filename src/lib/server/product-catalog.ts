import type { SupabaseClient } from '@supabase/supabase-js';

/** Sostituire il catalogo di un brand. Tre chiamanti scrivevano queste due righe per conto loro. */
export async function replaceBrandCatalog(
  supabase: SupabaseClient,
  brandId: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  await supabase.from('products').delete().eq('brand_id', brandId);
  await supabase.from('products').insert(rows);
}
