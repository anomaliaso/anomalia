import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { recordMemoryUsage } from '$lib/server/brand-memory';
import { MEMORY_USED_MAX } from '@anomalia/api-contracts';

// USARE NON È LEGGERE, ED È PER QUESTO CHE È UNA SCRITTURA. Dentro le due cose collassano — il
// turno inietta ciò che carica — ma un agente esterno elenca quaranta voci e ne usa due: contarle
// tutte alla lettura sarebbe un dato peggiore, e un GET con effetto collaterale.
//
// Gli id si filtrano PRIMA di contarli: un id di un altro brand terrebbe viva la memoria del
// vicino, e la risposta non deve nemmeno lasciar capire che quell'id esiste.

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = (await request.json()) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && !!id) : [];

  if (!ids.length) return json({ error: 'ids_required' }, { status: 400 });
  if (ids.length > MEMORY_USED_MAX) return json({ error: 'too_many_ids' }, { status: 400 });

  const { data: owned } = await supabase
    .from('brand_memory')
    .select('id')
    .eq('brand_id', brand.id)
    .in('id', ids);

  const mine = (owned ?? []).map((row) => row.id as string);
  if (mine.length) await recordMemoryUsage(supabase, mine);

  return json({ ok: true, counted: mine.length });
};
