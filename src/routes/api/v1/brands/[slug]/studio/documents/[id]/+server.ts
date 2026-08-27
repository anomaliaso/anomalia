import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  // Get document to check for storage file
  const { data: doc } = await supabase
    .from('brand_documents').select('file_url').eq('id', params.id).eq('brand_id', brand.id).maybeSingle();

  if (!doc) return json({ error: 'Document not found' }, { status: 404 });

  // Remove from storage if file exists
  if (doc.file_url) {
    try {
      await supabase.storage.from('brand-knowledge').remove([doc.file_url]);
    } catch (error) { swallow('remove document file', error); }
  }

  const { error: deleteError } = await supabase
    .from('brand_documents').delete().eq('id', params.id);

  if (deleteError) return json({ error: deleteError.message }, { status: 500 });

  // Rebuild brand context
  try {
    const { rebuildBrandContext } = await import('$lib/server/brand-context');
    await rebuildBrandContext(supabase, brand.id);
  } catch (error) { swallow('rebuild brand context', error); }

  return json({ ok: true });
};
