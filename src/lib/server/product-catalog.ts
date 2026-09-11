import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sostituire il catalogo di un brand: prima entra il nuovo, poi esce il vecchio.
 *
 *   vecchio ordine:  delete(tutto) → insert(tutte le righe)   un insert che fallisce = catalogo perso
 *   questo ordine:   insert(nuove) → delete(le vecchie)       un insert che fallisce = catalogo intatto
 *
 * I due passi non stanno in una transazione — PostgREST non ne ha una — quindi per un istante
 * esistono entrambi gli insiemi. Nessun vincolo lo vieta (`products` non ha un unico su
 * `(brand_id, external_id)`), ogni lettore del catalogo è una `select`, e un conteggio doppio per
 * una frazione di secondo non è paragonabile a un catalogo cancellato per sempre.
 *
 * Le righe arrivano da uno scraper su un sito che non controlliamo, e i CHECK su `products` sono
 * veri: una riga malformata fa fallire l'INSERT, che in Postgres è atomico — una su quaranta e non
 * ne entra nessuna. Per questo il lotto che fallisce viene ritentato riga per riga: chi passa
 * entra, chi no torna al chiamante col motivo che ha dato il database. I vincoli NON sono
 * riscritti qui: li dichiara la migration, e giudica Postgres.
 */

const DELETE_CHUNK = 100;

export type RejectedProduct = { title: string; reason: string };

export type CatalogReplacement = {
  inserted: number;
  rejected: RejectedProduct[];
  /** false quando non è entrata nessuna riga: il catalogo di prima è ancora quello buono. */
  replaced: boolean;
};

type ProductRow = Record<string, unknown>;

async function insertSalvagingRows(
  supabase: SupabaseClient,
  rows: ProductRow[]
): Promise<RejectedProduct[]> {
  const { error } = await supabase.from('products').insert(rows);
  if (!error) return [];

  const rejected: RejectedProduct[] = [];
  for (const row of rows) {
    const { error: rowError } = await supabase.from('products').insert(row);
    if (rowError) rejected.push({ title: String(row.title ?? ''), reason: rowError.message });
  }
  return rejected;
}

export async function replaceBrandCatalog(
  supabase: SupabaseClient,
  brandId: string,
  rows: ProductRow[]
): Promise<CatalogReplacement> {
  const { data: stale, error: readError } = await supabase
    .from('products')
    .select('id')
    .eq('brand_id', brandId);
  if (readError) throw new Error(`catalog read failed: ${readError.message}`);

  const rejected = await insertSalvagingRows(supabase, rows);
  const inserted = rows.length - rejected.length;
  if (!inserted) return { inserted, rejected, replaced: false };

  const staleIds = (stale ?? []).map((row) => String(row.id));
  for (let i = 0; i < staleIds.length; i += DELETE_CHUNK) {
    const { error } = await supabase
      .from('products')
      .delete()
      .in('id', staleIds.slice(i, i + DELETE_CHUNK));
    if (error) throw new Error(`old catalog left next to the new one: ${error.message}`);
  }

  return { inserted, rejected, replaced: true };
}
