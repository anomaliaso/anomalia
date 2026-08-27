import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { getBacklinks } from '$lib/server/cli-queries';
import { withBrandContext } from '$lib/server/ai-log';
import { createAdminClient } from '$lib/server/supabase-admin';
import { hasBacklinkNetwork } from '$lib/plans';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  return json(await getBacklinks(supabase, brand.id));
};

// POST — regenerate open give/receive opportunities for this brand (Starter+ only).
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  if (!hasBacklinkNetwork(brand.plan)) {
    return json(
      { error: 'Backlink network requires Starter or above', code: 'plan_required', upgrade: 'starter' },
      { status: 402 }
    );
  }

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  return withBrandContext(brand.id, async () => {
    const { generateBacklinkOpportunities } = await import('$lib/server/backlink-network');
    const counts = await generateBacklinkOpportunities(createAdminClient(), brand);
    return json({ ok: true, ...counts });
  });
};
