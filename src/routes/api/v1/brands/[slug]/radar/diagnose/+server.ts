import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';
import { radarDiagnose } from '$lib/server/radar';

// GET /api/v1/brands/:slug/radar/diagnose — fetch every configured Radar source live and report
// what each one returned, or why it was skipped (plan gate, platform toggle, source off, endpoint
// error). Read-only: no AI, no writes, nothing queued.
//
// Fetching several feeds serially can outlast the default budget.
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

  return json(await radarDiagnose(createAdminClient(), brand));
};
