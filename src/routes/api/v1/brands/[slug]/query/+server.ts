import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { QUERY_DATABASE } from '@anomalia/api-contracts';
import { createQueryTool } from '$lib/server/chat/query-tool';

/**
 * `query` sopra REST, e quindi sopra CLI e MCP. Non riscrive niente: monta lo STESSO tool della
 * chat, quindi tetti, traduzione degli errori, confine del brand e — soprattutto — il rifiuto del
 * client service-role sono un solo pezzo di codice, non due che divergono al primo cambiamento.
 *
 * `authenticate` restituisce il client dell'utente sul percorso JWT (marchiato RLS-scoped) e la
 * service role sul percorso a chiave API: nel secondo caso `query` si rifiuta da solo, ed è la
 * ragione per cui qui non c'è nessun controllo in più da ricordarsi.
 *
 * POST per la forma dell'input, non per l'effetto: `where` è un array di oggetti, e passarlo come
 * JSON dentro una querystring sarebbe una serializzazione in più da sbagliare. La lettura non
 * spende niente e resta `destructive: false` nel registro.
 */
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, user, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = QUERY_DATABASE.input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { query } = createQueryTool({ supabase, brandId: brand.id, userId: user.id });
  const read = query.execute as (input: unknown, options: unknown) => Promise<unknown>;

  return json(await read(parsed.data, {}));
};
