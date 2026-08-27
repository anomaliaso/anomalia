import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { ingestDocument, kickKnowledgeWork } from '$lib/server/knowledge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withBrand<T>(supabase: any, slug: string, fn: (brand: any) => Promise<T>): Promise<T> {
  const { data: brand } = await supabase
    .from('brands')
    .select('id, plan, slug')
    .eq('slug', slug)
    .maybeSingle();
  if (!brand) return fail(404, { error: 'Brand not found' }) as T;
  return withBrandContext(brand.id, () => fn(brand));
}

export const load: PageServerLoad = async ({ parent }) => {
  await parent();
  return {};
};

export const actions: Actions = {
  addNote: async ({ request, params, locals: { supabase, safeGetSession }, url }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });
      const fd = await request.formData();
      const title = String(fd.get('title') ?? '').trim() || 'Note';
      const body = String(fd.get('content_text') ?? '').trim();
      if (!body) return fail(400, { error: 'Note is empty' });
      try {
        await ingestDocument(supabase, brand.id, user.id, {
          title,
          text: body,
          plan: brand.plan
        });
        void kickKnowledgeWork(url.origin);
      } catch (e) {
        return fail(400, { error: e instanceof Error ? e.message : String(e) });
      }
      redirect(303, `/app/${brand.slug}/knowledge`);
    });
  },

  uploadDocument: async ({ request, params, locals: { supabase, safeGetSession }, url }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });
      const fd = await request.formData();
      const paths = fd.getAll('path').map(String).filter(Boolean);
      const fileNames = fd.getAll('file_name').map(String);
      const mimeTypes = fd.getAll('mime_type').map(String);
      const sizes = fd.getAll('bytes').map((v) => Number(v) || undefined);
      if (!paths.length) return fail(400, { error: 'No file uploaded' });

      try {
        for (let i = 0; i < paths.length; i++) {
          await ingestDocument(supabase, brand.id, user.id, {
            path: paths[i],
            fileName: fileNames[i],
            mimeType: mimeTypes[i],
            bytes: sizes[i],
            plan: brand.plan
          });
        }
        void kickKnowledgeWork(url.origin);
      } catch (e) {
        return fail(400, { error: e instanceof Error ? e.message : String(e) });
      }
      redirect(303, `/app/${brand.slug}/knowledge`);
    });
  },

  addUrl: async ({ request, params, locals: { supabase, safeGetSession }, url }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const { user } = await safeGetSession();
      if (!user) return fail(401, { error: 'Not authenticated' });
      const fd = await request.formData();
      const sourceUrl = String(fd.get('url') ?? '').trim();
      const title = String(fd.get('title') ?? '').trim() || undefined;
      if (!sourceUrl) return fail(400, { error: 'URL required' });
      try {
        await ingestDocument(supabase, brand.id, user.id, {
          url: sourceUrl,
          title,
          plan: brand.plan
        });
        void kickKnowledgeWork(url.origin);
      } catch (e) {
        return fail(400, { error: e instanceof Error ? e.message : String(e) });
      }
      redirect(303, `/app/${brand.slug}/knowledge`);
    });
  }
};
