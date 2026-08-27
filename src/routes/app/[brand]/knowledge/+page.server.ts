import { swallow } from '$lib/server/swallow';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import {
  COLLECTIONS,
  kickKnowledgeWork,
  reprocessDocument,
  saveDocumentMarkdown
} from '$lib/server/knowledge';
import {
  deleteMemory,
  loadMemoryEntries,
  updateMemoryEntry
} from '$lib/server/brand-memory';
import { knowledgeConnectorsEnabled, loadKnowledgeSources } from '$lib/server/knowledge-sources';
import { cachedBrandPage } from '$lib/server/page-cache';

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

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    // No markdown, no chunk contents: the drawer fetches those per document from
    // /app/[brand]/knowledge/[id]. See docs/23 §11.
    const [{ data: documents }, memories, { data: edges }, sources] = await Promise.all([
      supabase
        .from('brand_documents')
        .select(
          'id, kind, title, summary, status, error, chunk_count, bytes, page_count, source_type, source_url, file_name, mime_type, collection, lang, created_at, processed_at'
        )
        .eq('brand_id', brand.id)
        .neq('kind', 'image')
        .order('created_at', { ascending: false })
        .limit(400),
      loadMemoryEntries(supabase, brand.id),
      supabase
        .from('brand_knowledge_edges')
        .select('id, src_kind, src_id, dst_kind, dst_id, rel, confidence')
        .eq('brand_id', brand.id)
        .in('rel', ['contradicts'])
        .limit(1000),
      loadKnowledgeSources(supabase, brand.id).catch((error) => { swallow('load knowledge sources', error); return []; })
    ]);

    const contradictMemoryIds = new Set<string>();
    for (const e of edges ?? []) {
      if (e.rel !== 'contradicts') continue;
      if (e.src_kind === 'memory') contradictMemoryIds.add(e.src_id as string);
      if (e.dst_kind === 'memory') contradictMemoryIds.add(e.dst_id as string);
    }

    const pending =
      (documents ?? []).filter((d) => d.status === 'pending' || d.status === 'processing').length > 0;
    const sourcesPending = sources.some((s) => s.status === 'pending_sync' || s.status === 'syncing');

    return {
      documents: documents ?? [],
      memories,
      contradictMemoryIds: [...contradictMemoryIds],
      pending: pending || sourcesPending,
      sources,
      connectorsConfigured: knowledgeConnectorsEnabled()
    };
  });
};

export const actions: Actions = {
  // Document create forms live on /knowledge/new — only list/edit actions remain here.

  deleteDocument: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      const { data: doc } = await supabase
        .from('brand_documents')
        .select('id, file_url, kind')
        .eq('id', id)
        .eq('brand_id', brand.id)
        .maybeSingle();
      if (!doc || doc.kind === 'image') return fail(400, { error: 'Not found' });
      if (doc.file_url) await supabase.storage.from('brand-knowledge').remove([doc.file_url]);
      await supabase.from('brand_documents').delete().eq('id', id).eq('brand_id', brand.id);
      return { deleted: true };
    });
  },

  reprocess: async ({ request, params, locals: { supabase }, url }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const id = String((await request.formData()).get('id') ?? '');
      await reprocessDocument(supabase, brand.id, id);
      void kickKnowledgeWork(url.origin);
      return { queued: true };
    });
  },

  saveMarkdown: async ({ request, params, locals: { supabase }, url }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      const markdown = String(fd.get('markdown') ?? '');
      await saveDocumentMarkdown(supabase, brand.id, id, markdown);
      void kickKnowledgeWork(url.origin);
      return { saved: true };
    });
  },

  setCollection: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      const raw = String(fd.get('collection') ?? '').trim();
      const collection = COLLECTIONS.includes(raw as (typeof COLLECTIONS)[number]) ? raw : null;
      await supabase
        .from('brand_documents')
        .update({ collection })
        .eq('id', id)
        .eq('brand_id', brand.id);
      return { saved: true };
    });
  },

  updateMemory: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const id = String(fd.get('id') ?? '');
      const pinned = fd.get('pinned');
      const importance = fd.get('importance');
      const patch: { pinned?: boolean; importance?: number } = {};
      if (pinned != null) patch.pinned = String(pinned) === 'true' || String(pinned) === '1';
      if (importance != null) {
        const n = Number(importance);
        if (n >= 1 && n <= 5) patch.importance = n;
      }
      // Ensure the row belongs to this brand.
      const { data } = await supabase
        .from('brand_memory')
        .select('id')
        .eq('id', id)
        .eq('brand_id', brand.id)
        .maybeSingle();
      if (!data) return fail(404, { error: 'Not found' });
      await updateMemoryEntry(supabase, brand.id, id, patch);
      return { saved: true };
    });
  },

  deleteMemory: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const id = String((await request.formData()).get('id') ?? '');
      const { data } = await supabase
        .from('brand_memory')
        .select('id')
        .eq('id', id)
        .eq('brand_id', brand.id)
        .maybeSingle();
      if (!data) return fail(404, { error: 'Not found' });
      await deleteMemory(supabase, brand.id, id);
      return { deleted: true };
    });
  }
};
