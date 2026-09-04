import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json();
  const { title, kind } = body;
  const content_text = body.content_text ?? body.text;

  if (!content_text && kind !== 'document') {
    return json({ error: 'content_text is required' }, { status: 400 });
  }

  // Sanitize
  const sanitized = (content_text ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  const { data, error: insertError } = await supabase
    .from('brand_documents')
    .insert({
      brand_id: brand.id,
      kind: kind ?? 'note',
      title: title ?? 'Note',
      content_text: sanitized || null,
    })
    .select('id, kind, title')
    .single();

  if (insertError) return json({ error: insertError.message }, { status: 500 });

  // Rebuild brand context (best-effort)
  try {
    const { rebuildBrandContext } = await import('$lib/server/brand-context');
    await rebuildBrandContext(supabase, brand.id);
  } catch (error) { swallow('rebuild brand context', error); }

  return json({ ok: true, document: data });
};
