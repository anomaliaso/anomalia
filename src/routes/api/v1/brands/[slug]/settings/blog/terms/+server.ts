import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { ADD_BLOG_TERM, statusForFailure } from '@anomalia/api-contracts';
import { BLOG_TERMS, blogTermSlug } from '$lib/server/blog-settings';
import { createAdminClient } from '$lib/server/supabase-admin';

// POST /api/v1/brands/:slug/settings/blog/terms — una categoria, un tag o un autore in più.
//
// Le tre liste hanno la stessa forma (nome → slug derivato, unico per brand) e differiscono solo
// per i campi in più che accettano. La tabella `BLOG_TERMS` è quella differenza, in un posto solo.

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = ADD_BLOG_TERM.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { term, name, ...extras } = parsed.data;
  const spec = BLOG_TERMS[term];
  const fail = (e: string, extra: Record<string, unknown> = {}) =>
    json({ error: e, ...extra }, { status: statusForFailure(ADD_BLOG_TERM, e) });

  // Un campo mandato alla lista sbagliata viene RIFIUTATO, non scartato: salvarlo altrove o
  // ignorarlo lascerebbe l'agente convinto di aver scritto una biografia che non esiste.
  const stray = Object.keys(extras).filter(
    (k) => extras[k as keyof typeof extras] !== undefined && !(spec.extras as readonly string[]).includes(k)
  );
  if (stray.length) {
    return fail('field_not_for_term', { term, stray, accepts: [...spec.extras] });
  }

  const cleanName = String(name).trim().slice(0, spec.nameMax);
  const slug = blogTermSlug(cleanName, spec.slugMax);
  if (!slug) return fail('empty_slug', { name: cleanName });

  const admin = createAdminClient();
  const { data: clash } = await admin
    .from(spec.table)
    .select('id')
    .eq('brand_id', brand.id)
    .eq('slug', slug)
    .maybeSingle();
  if (clash) return fail('slug_taken', { term, slug, id: clash.id });

  const row: Record<string, unknown> = { brand_id: brand.id, name: cleanName, slug };
  for (const key of spec.extras) {
    const value = extras[key as keyof typeof extras];
    if (value === undefined) continue;
    row[key] = String(value).trim().slice(0, spec.extraMax[key] ?? 300) || null;
  }

  const { data: created, error: insertError } = await admin
    .from(spec.table)
    .insert(row)
    .select('id')
    .single();

  if (insertError || !created) {
    return fail('insert_failed', { detail: insertError?.message });
  }

  return json({ ok: true, term, id: created.id, name: cleanName, slug });
};
