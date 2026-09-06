import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { INSERT_ROW, UPDATE_ROW } from '@anomalia/api-contracts';
import { createWriteTools } from '$lib/server/chat/write-tool';

/**
 * `insert_row` e `update_row` sopra REST, e quindi sopra CLI e MCP. Come la rotta di `query`, non
 * riscrive niente: monta lo STESSO codice, quindi cancello, confine del brand, tetto sulle righe e
 * traduzione degli errori sono un pezzo solo che non può divergere.
 *
 * `authenticate` restituisce il client dell'utente sul percorso JWT e la service role su quello a
 * chiave API: nel secondo caso lo strumento si rifiuta da solo. Non c'è nessun `checkApiKeyWriteAccess`
 * qui perché non ci arriverebbe mai — quel percorso è già chiuso a monte, e un secondo cancello
 * sulla stessa porta è una condizione in più da tenere allineata, non una difesa in più.
 *
 * POST inserisce, PUT aggiorna: il verbo HTTP è quello dell'operazione, e il registro ne ricava
 * `destructive` per tool — false sull'una, true sull'altra.
 */
const write = async (request: Request, slug: string, op: 'insert' | 'update') => {
  const { supabase, error, user, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, slug, apiKey);
  if (brandError) return brandError;

  const contract = op === 'insert' ? INSERT_ROW : UPDATE_ROW;
  const parsed = contract.input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const tools = createWriteTools({ supabase, brandId: brand.id, userId: user.id });

  return json(
    op === 'insert'
      ? await tools.insertRow(parsed.data as Parameters<typeof tools.insertRow>[0])
      : await tools.updateRow(parsed.data as Parameters<typeof tools.updateRow>[0])
  );
};

export const POST: RequestHandler = ({ request, params }) => write(request, params.slug, 'insert');

export const PUT: RequestHandler = ({ request, params }) => write(request, params.slug, 'update');
