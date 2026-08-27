import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { loadGoalHistory, summarizeGoals } from '$lib/server/chat/goal-log';

// GET /api/v1/brands/:slug/goals — gli obiettivi della chat e come sono andati.
//
// La modalità obiettivo lascia due tracce: lo STATO (`chat_goals`, che la chat mostra già nella
// card) e la STORIA (`chat_goal_events`, una riga per ogni cosa che è successa). Questo endpoint
// serve la seconda, che è quella che risponde alla domanda vera su una funzione nuova: **funziona?**
//
// Il riassunto in cima è il punto. Non "quanti obiettivi ci sono" ma quanti si chiudono al primo
// colpo, quanti tornano alla persona, e per quale ragione le catene si fermano — perché è da lì
// che si capisce se il tetto dei quattro giri è generoso, stretto, o non lo tocca mai nessuno.
//
// Read-only: nessuna scrittura, nessuna AI, nessun credito.
//
// Query:
//   ?limit=20     quanti obiettivi (1-100)
//   ?thread=<id>  solo quelli di una conversazione

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const limitParam = Number(url.searchParams.get('limit'));
  const threadId = url.searchParams.get('thread') ?? undefined;
  // Il client dell'utente, non l'admin: gli obiettivi sono suoi e la RLS è già la regola giusta.
  const goals = await loadGoalHistory(supabase, brand.id, {
    ...(Number.isFinite(limitParam) && limitParam > 0 ? { limit: Math.trunc(limitParam) } : {}),
    ...(threadId ? { threadId } : {})
  });

  return json({ brand: brand.slug, summary: summarizeGoals(goals), goals });
};
