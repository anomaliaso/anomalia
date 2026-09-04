import type { SupabaseClient } from '@supabase/supabase-js';

// L'unico posto che decide cosa vuol dire "questa riga non è tua". Una update o una delete
// filtrata per brand tocca zero righe sia quando l'id non esiste sia quando appartiene a un altro
// brand: la risposta deve essere la stessa nei due casi, o il 404 diventa un oracolo che dice a
// chi chiede se quell'id esiste da qualche altra parte.

export const ROW_NOT_FOUND = 'not_found';
export const EMPTY_PATCH = 'no_fields';

export type RowFailure = { error: string; status: number };

type Affected = { data: { id: string }[] | null; error: { message: string } | null };

export async function updateBrandRow(
  supabase: SupabaseClient,
  table: string,
  brandId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<RowFailure | null> {
  if (!Object.keys(patch).length) return { error: EMPTY_PATCH, status: 400 };

  return verdict(
    (await supabase
      .from(table)
      .update(patch)
      .eq('id', id)
      .eq('brand_id', brandId)
      .select('id')) as Affected
  );
}

export async function deleteBrandRow(
  supabase: SupabaseClient,
  table: string,
  brandId: string,
  id: string
): Promise<RowFailure | null> {
  return verdict(
    (await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .eq('brand_id', brandId)
      .select('id')) as Affected
  );
}

function verdict({ data, error }: Affected): RowFailure | null {
  if (error) return { error: error.message, status: 500 };
  if (!data?.length) return { error: ROW_NOT_FOUND, status: 404 };
  return null;
}
