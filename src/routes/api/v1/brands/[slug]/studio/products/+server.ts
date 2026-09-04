import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { CREATE_PRODUCT, statusForFailure } from '@anomalia/api-contracts';

// POST /studio/products aggiunge UNA riga al catalogo. La POST su /products è un'altra cosa: quella
// risincronizza il catalogo intero da Shopify o WooCommerce e prima cancella tutto — un prodotto
// scritto a mano non sopravviverebbe.
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = CREATE_PRODUCT.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { data, error: insertError } = await supabase
    .from('products')
    .insert({ brand_id: brand.id, ...parsed.data })
    .select('id, title, kind, pricing, featured')
    .single();

  if (insertError) {
    return json(
      { error: 'insert_failed', details: insertError.message },
      { status: statusForFailure(CREATE_PRODUCT, 'insert_failed') }
    );
  }

  return json({ ok: true, product: data });
};
