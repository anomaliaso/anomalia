import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { knowledgeStatus } from '$lib/server/knowledge';
import { loadKnowledgeSources } from '$lib/server/knowledge-sources';

// Lo stato della pipeline della conoscenza, per chi cerca e non trova niente: `search_knowledge`
// vuoto su un corpus indicizzato significa «il brand non sa questa cosa», su un corpus in coda
// significa «nessuno l'ha ancora letto». Due situazioni opposte, due azioni opposte.
//
// Nessun modello, nessun credito, nessuna scrittura: sono conteggi.

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const [status, sources] = await Promise.all([
    knowledgeStatus(supabase, brand.id),
    loadKnowledgeSources(supabase, brand.id)
  ]);

  return json({
    ...status,
    sources: sources.map((source) => ({
      provider: source.provider,
      displayName: source.display_name ?? null,
      status: source.status,
      lastSyncAt: source.last_sync_at ?? null,
      lastError: source.last_error ?? null,
      docsIngested: source.docs_ingested ?? 0
    }))
  });
};
