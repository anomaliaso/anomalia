import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { REMOVE_BLOG_TERM, statusForFailure } from '@anomalia/api-contracts';
import { BLOG_TERMS } from '$lib/server/blog-settings';
import { createAdminClient } from '$lib/server/supabase-admin';

// POST /api/v1/brands/:slug/settings/blog/terms/remove — una voce in meno.
//
// Nessun articolo viene cancellato, ma ognuna delle tre lascia un segno diverso: categoria e
// autore staccano un riferimento (`on delete set null`), un tag sparisce dalla tabella di mezzo
// (`on delete cascade`). Il conto degli articoli toccati si fa PRIMA della cancellazione — dopo,
// la riga che lo permetteva non esiste più — e torna nella risposta: la conseguenza contata, non
// promessa.

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = REMOVE_BLOG_TERM.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { term, id } = parsed.data;
  const spec = BLOG_TERMS[term];
  const admin = createAdminClient();

  const { data: row } = await admin
    .from(spec.table)
    .select('id')
    .eq('id', id)
    .eq('brand_id', brand.id)
    .maybeSingle();

  if (!row) {
    return json(
      { error: 'not_found', term, id },
      { status: statusForFailure(REMOVE_BLOG_TERM, 'not_found') }
    );
  }

  const { data: affected } = await admin.from(spec.refTable).select('id').eq(spec.refColumn, id);

  const { error: deleteError } = await admin
    .from(spec.table)
    .delete()
    .eq('id', id)
    .eq('brand_id', brand.id);

  if (deleteError) {
    return json(
      { error: 'delete_failed', detail: deleteError.message },
      { status: statusForFailure(REMOVE_BLOG_TERM, 'delete_failed') }
    );
  }

  return json({ ok: true, term, id, articles_affected: (affected ?? []).length });
};
