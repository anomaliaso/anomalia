/**
 * Una volta al giorno: chiedi il listino al gateway e metti in vetrina le uscite nuove.
 *
 * Aggiunge una riga sola per vendor — il modello piu` recente che il gateway serve, fra i vendor
 * che la tabella gia` segue. Non disabilita niente e non cancella niente: un modello ritirato
 * sparisce dal menu da solo perche' il listino non lo serve piu`, e togliere la sua riga sarebbe
 * cancellare la scelta di qualcuno per un guasto temporaneo di /models.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { ensureGatewayModels } from '$lib/server/openrouter-models';
import { catalogModelIds, newModelsForCatalog, __resetChatModelCatalog } from '$lib/server/chat-model-catalog';

const NEW_MODEL_POSITION = 500;

export const GET: RequestHandler = async ({ request }) => {
  if (!cronAuthorized(request)) return json({ error: 'unauthorized' }, { status: 401 });

  await ensureGatewayModels();
  const known = await catalogModelIds();
  if (!known.length) return json({ added: [], skipped: 'catalogo vuoto: nessun vendor da seguire' });

  const added = newModelsForCatalog(known);
  if (!added.length) return json({ added: [] });

  const { error } = await createAdminClient()
    .from('chat_model_catalog')
    .upsert(
      added.map((model_id) => ({ model_id, position: NEW_MODEL_POSITION, source: 'auto' })),
      { onConflict: 'model_id', ignoreDuplicates: true }
    );

  if (error) return json({ error: error.message }, { status: 500 });

  __resetChatModelCatalog();
  return json({ added });
};
