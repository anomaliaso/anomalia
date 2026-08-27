import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Document detail, fetched only when the drawer opens. The list page must NOT ship markdown +
 * chunk contents for the whole corpus: at 300 documents that is tens of MB in the SSR payload
 * (docs/23 §11 — the first thing that breaks at scale is always the payload, not the database).
 */
export const GET: RequestHandler = async ({ params, locals: { supabase } }) => {
  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  const [{ data: doc }, { data: chunks }] = await Promise.all([
    supabase
      .from('brand_documents')
      .select('id, title, markdown, summary, status, error, chunk_count, collection, lang')
      .eq('id', params.id)
      .eq('brand_id', brand.id)
      .maybeSingle(),
    supabase
      .from('brand_doc_chunks')
      .select('id, idx, heading_path, content, tokens')
      .eq('document_id', params.id)
      .eq('brand_id', brand.id)
      .order('idx', { ascending: true })
      .limit(500)
  ]);

  if (!doc) throw error(404, 'Document not found');
  return json({ document: doc, chunks: chunks ?? [] });
};
