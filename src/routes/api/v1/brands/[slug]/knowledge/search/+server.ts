import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { searchKnowledge, COLLECTIONS, type Collection } from '$lib/server/knowledge';
import {
  KNOWLEDGE_EXCERPT_CHARS,
  KNOWLEDGE_HITS_DEFAULT,
  KNOWLEDGE_HITS_MAX
} from '@anomalia/api-contracts';

// Interrogare la conoscenza del brand come faceva l'agente interno: la stessa `searchKnowledge`
// (FTS, e un embedding della domanda solo quando le parole chiave non bastano), esposta a chi
// lavora da fuori. Nessun modello generativo, nessun credito, nessuna scrittura — quindi niente
// `gateAiAction`: chi ha finito i crediti può ancora leggere quello che ha già pagato per indicizzare.
//
// L'isolamento non passa dalla RLS: sul percorso a chiave API `authenticate` restituisce il client
// di servizio. Il brand viene da `loadBrandForUser`, mai da un parametro di chi chiama.

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const query = (url.searchParams.get('query') ?? '').trim();
  if (!query) return json({ error: 'query_required' }, { status: 400 });

  const requested = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(KNOWLEDGE_HITS_MAX, Math.round(requested))
    : KNOWLEDGE_HITS_DEFAULT;

  const asked = url.searchParams.get('collection');
  const collection = COLLECTIONS.includes(asked as Collection) ? (asked as Collection) : null;

  const hits = await searchKnowledge(supabase, brand.id, query, { limit, collection });

  return json({
    query,
    count: hits.length,
    hits: hits.map((hit) => ({
      chunkId: hit.chunkId,
      documentId: hit.documentId,
      title: hit.title,
      headingPath: hit.headingPath,
      excerpt: hit.content.slice(0, KNOWLEDGE_EXCERPT_CHARS),
      truncated: hit.content.length > KNOWLEDGE_EXCERPT_CHARS,
      score: hit.score
    }))
  });
};
