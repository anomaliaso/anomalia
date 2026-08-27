import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteDisruptiveIdea,
  listDisruptiveIdeas,
  saveDisruptiveIdea,
  updateDisruptiveIdea
} from '$lib/server/disruptive-ideas';
import { isContrastDeviceId, isDisruptiveStatus } from '$lib/disruptive';

// IL BANCO IDEE — la pagina che rende ripescabile quello che l'AI ha pensato di dirompente.
//
// È di sola gestione: qui non si genera niente. Le idee arrivano dagli agenti mentre lavorano
// (save_disruptive_idea), e questa pagina serve a rileggerle, metterle in lista, segnarle come
// usate e buttare quelle che non reggono. Un umano può aggiungerne una a mano: l'idea buona in
// doccia deve poter entrare nello stesso banco da cui pesca l'AI.

type BrandRow = { id: string; name: string; slug: string };

/**
 * Il brand lo ha già risolto il layout: `parent()` invece di una seconda query, come ogni altra
 * pagina di questo hub. Non è solo un giro di rete in meno — gli slug in questo database NON sono
 * unici (lo stesso brand creato due volte), e un `.eq(slug).maybeSingle()` su due righe fallisce
 * invece di rispondere, trasformando una pagina normale in un 404 senza spiegazione.
 */
async function requireBrand(supabase: SupabaseClient, slug: string): Promise<BrandRow> {
  const { data } = await supabase
    .from('brands')
    .select('id, name, slug')
    .eq('slug', slug)
    .order('created_at', { ascending: false })
    .limit(1);
  const brand = data?.[0];
  if (!brand) throw error(404, 'Brand not found');
  return brand as BrandRow;
}

export const load: PageServerLoad = async ({ parent, params, locals: { supabase } }) => {
  // Le action non hanno `parent()` (è solo dei load), quindi la query di riserva resta: qui si
  // preferisce comunque il brand che il layout ha già risolto.
  const fromLayout = (await parent()) as { brand?: BrandRow };
  const brand = fromLayout.brand?.id ? fromLayout.brand : await requireBrand(supabase, params.brand);
  const ideas = await listDisruptiveIdeas(supabase, brand.id, { status: 'all', limit: 200 });
  return { ideas };
};

export const actions: Actions = {
  setStatus: async ({ params, request, locals: { supabase } }) => {
    const brand = await requireBrand(supabase, params.brand as string);
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    const status = String(data.get('status') ?? '');
    if (!id || !isDisruptiveStatus(status)) return fail(400, { error: 'bad_request' });
    const updated = await updateDisruptiveIdea(supabase, brand.id, id, { status });
    if (!updated) return fail(500, { error: 'update_failed' });
    return { updated: id };
  },

  remove: async ({ params, request, locals: { supabase } }) => {
    const brand = await requireBrand(supabase, params.brand as string);
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'bad_request' });
    const ok = await deleteDisruptiveIdea(supabase, brand.id, id);
    if (!ok) return fail(500, { error: 'delete_failed' });
    return { deleted: id };
  },

  add: async ({ params, request, locals: { supabase, user } }) => {
    const brand = await requireBrand(supabase, params.brand as string);
    const data = await request.formData();
    const title = String(data.get('title') ?? '').trim();
    const idea = String(data.get('idea') ?? '').trim();
    if (!title || !idea) return fail(400, { error: 'missing_fields' });
    const device = String(data.get('device') ?? '');
    const saved = await saveDisruptiveIdea(supabase, brand.id, user?.id ?? null, {
      title,
      idea,
      device: isContrastDeviceId(device) ? device : null,
      whyItContrasts: String(data.get('why_it_contrasts') ?? '').trim() || null,
      whoItAnnoys: String(data.get('who_it_annoys') ?? '').trim() || null,
      format: String(data.get('format') ?? '').trim() || null,
      surface: 'manual'
    });
    if (!saved.ok) return fail(500, { error: 'save_failed' });
    return { added: saved.idea.id, duplicate: saved.duplicate };
  }
};
