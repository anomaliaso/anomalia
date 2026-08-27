import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import {
  catalogBrandMedia,
  deleteBrandMedia,
  insertBrandMedia,
  listBrandMedia
} from '$lib/server/brand-media';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withBrand<T>(supabase: any, slug: string, fn: (brand: any) => Promise<T>): Promise<T> {
  const { data: brand } = await supabase.from('brands').select('id').eq('slug', slug).maybeSingle();
  if (!brand) return fail(404, { error: 'Brand not found' }) as T;
  return withBrandContext(brand.id, () => fn(brand));
}

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand } = await parent();

  async function loadDeferred() {
    const items = await listBrandMedia(supabase, brand.id, { limit: 120 });
    return { items };
  }

  return {
    deferred: loadDeferred()
  };
};

export const actions: Actions = {
  // Client uploads to Storage first, then posts path + metadata here.
  upload: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });

      const fd = await request.formData();
      const paths = fd.getAll('path').map(String).filter(Boolean);
      const fileNames = fd.getAll('file_name').map(String);
      const mimeTypes = fd.getAll('mime_type').map(String);
      const sizes = fd.getAll('size_bytes').map((v) => Number(v) || null);
      const widths = fd.getAll('width').map((v) => Number(v) || null);
      const heights = fd.getAll('height').map((v) => Number(v) || null);
      const durations = fd.getAll('duration_seconds').map((v) => Number(v) || null);

      if (!paths.length) return fail(400, { error: 'No files uploaded' });

      const insertedIds: string[] = [];
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        if (!path.startsWith(`${user.id}/${brand.id}/`)) {
          return fail(400, { error: 'Invalid file path' });
        }
        const mime = mimeTypes[i] ?? '';
        if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
          return fail(400, { error: 'Only images and videos are supported' });
        }
        const { row, error } = await insertBrandMedia(supabase, {
          brandId: brand.id,
          userId: user.id,
          storagePath: path,
          fileName: fileNames[i] || path.split('/').pop() || 'asset',
          mime,
          bytes: sizes[i],
          width: widths[i],
          height: heights[i],
          durationSeconds: durations[i]
        });
        if (error || !row) return fail(400, { error: error ?? 'Insert failed' });
        insertedIds.push(row.id);
      }

      // Catalog each asset (vision for images). Cap parallelism to avoid Gemini rate spikes.
      const results: Array<{ id: string; ok: boolean }> = [];
      for (const id of insertedIds) {
        const r = await catalogBrandMedia(supabase, id, brand.id);
        results.push({ id, ok: r.ok });
      }

      return { saved: true, count: insertedIds.length, cataloged: results.filter((r) => r.ok).length };
    });
  },

  update: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      if (!id) return fail(400, { error: 'Missing id' });

      const tagsRaw = String(fd.get('tags') ?? '');
      const tags = tagsRaw
        .split(/[,#]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20);

      const patch = {
        title: String(fd.get('title') ?? '').trim() || null,
        description: String(fd.get('description') ?? '').trim() || null,
        tags,
        suggested_use: String(fd.get('suggested_use') ?? '').trim() || null,
        when_to_use: String(fd.get('when_to_use') ?? '').trim() || null,
        how_to_use: String(fd.get('how_to_use') ?? '').trim() || null,
        where_to_use: String(fd.get('where_to_use') ?? '').trim() || null,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('brand_media')
        .update(patch)
        .eq('id', id)
        .eq('brand_id', brand.id);
      if (error) return fail(400, { error: error.message });
      return { saved: true };
    });
  },

  recatalog: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      if (!id) return fail(400, { error: 'Missing id' });
      const r = await catalogBrandMedia(supabase, id, brand.id);
      if (!r.ok) return fail(400, { error: r.error ?? 'Catalog failed' });
      return { saved: true };
    });
  },

  delete: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      if (!id) return fail(400, { error: 'Missing id' });
      const r = await deleteBrandMedia(supabase, brand.id, id);
      if (!r.ok) return fail(400, { error: r.error ?? 'Delete failed' });
      return { saved: true };
    });
  }
};
