import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { getKeywords } from '$lib/server/cli-queries';
import { withBrandContext } from '$lib/server/ai-log';
import { createAdminClient } from '$lib/server/supabase-admin';

// DataForSEO round-trips + grounded expansion — same budget the keywords page gives its action.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~180s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 180 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  return json(await getKeywords(supabase, brand.id));
};

// POST — regenerate the keyword strategy from scratch.
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  return withBrandContext(brand.id, async () => {
    const { ensureKeywordStrategy } = await import('$lib/server/seo-keyword-strategy');
    const strategy = await ensureKeywordStrategy(createAdminClient(), brand, { force: true });
    if (!strategy) return json({ error: 'Could not generate keyword research' }, { status: 502 });
    return json({ ok: true, keywords: strategy.keywords?.length ?? 0 });
  });
};
