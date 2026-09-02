import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { slugWithRandomTail } from '$lib/brand-slug';

export const SLUG_CONSTRAINT = 'brands_slug_key';
export const ID_CONSTRAINT = 'brands_pkey';

/**
 * Quanti insert al massimo. Quattro coprono lo slug (proposto + tre code casuali); il quinto lascia
 * spazio all'unico ritentativo che un id coniato dal client può chiedere.
 */
const INSERT_ATTEMPTS = 5;

/**
 * Da dove viene `values.id`.
 *
 * `client-proposed` — l'onboarding conia l'uuid nel BROWSER e lo porta nel draft, perché il wizard
 * marca le chiamate AI su quel brand prima che il primo salvataggio risponda. È comodo, ma non è
 * una garanzia che l'id sia libero: se è già preso, la riga va creata lo stesso con un id nuovo.
 * `trusted` — l'id lo decide il server, e una collisione è un difetto vero che deve emergere.
 */
export type BrandIdSource = 'trusted' | 'client-proposed';

export type BrandInsertResult = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  error: string | null;
};

export type InsertBrandOptions = {
  select?: string;
  idSource?: BrandIdSource;
};

function violates(
  error: { message?: string; details?: string; code?: string } | null,
  constraint: string
): boolean {
  if (!error) return false;
  return `${error.message ?? ''} ${error.details ?? ''}`.includes(constraint);
}

export async function insertBrandWithSlug(
  supabase: SupabaseClient,
  values: Record<string, unknown>,
  opts: InsertBrandOptions = {}
): Promise<BrandInsertResult> {
  const select = opts.select ?? 'id, slug, timezone';
  const idSource = opts.idSource ?? 'trusted';
  const proposedSlug = values.slug as string;

  let id = values.id as string;
  let slug = proposedSlug;
  let idAlreadyMinted = false;

  for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('brands')
      .insert({ ...values, id, slug })
      .select(select)
      .single();
    if (!error) return { data, error: null };

    if (violates(error, ID_CONSTRAINT)) {
      // La riga che occupa quell'id NON si riprende mai: può essere di un altro org, e la lettura di
      // recupero del chiamante la vede `null` sotto RLS proprio perché non è sua. Riprenderla
      // vorrebbe dire consegnare il brand di qualcun altro a chi ne ha indovinato l'uuid.
      if (idSource !== 'client-proposed' || idAlreadyMinted) {
        return { data: null, error: error.message };
      }
      id = randomUUID();
      idAlreadyMinted = true;
      continue;
    }

    if (!violates(error, SLUG_CONSTRAINT)) return { data: null, error: error.message };

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

    slug = slugWithRandomTail(proposedSlug);
  }
  return { data: null, error: 'Could not pick a free URL for this workspace' };
}
