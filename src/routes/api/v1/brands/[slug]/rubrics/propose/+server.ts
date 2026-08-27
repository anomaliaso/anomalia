import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';
import { genaiClient } from '$lib/server/research';
import { withBrandContext } from '$lib/server/ai-log';
import { plannerProfile, planEvidence } from '$lib/server/planner-inputs';
import { activeGtmBrief } from '$lib/server/gtm';
import { proposeRubrics, saveProposedRubrics } from '$lib/server/rubrics';
import { localeLanguageName } from '$lib/i18n/locale';

// One Gemini call (~20-30s) grounded in the stored strategy evidence.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

// Generate a fresh batch of 5-8 candidate rubrics for the client to review. Replaces any
// previous still-pending batch (re-proposing = starting the review over).
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  // AI-spending action — requires a paid plan with credits (same standard as /seo, /geo, /web).
  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const body = await request.json().catch(() => ({}));
  // Output language: explicit body param wins (the web page passes the UI locale); default Italian
  // (the product's primary audience) rather than English so a client-facing document reads native.
  const outputLanguage = String(body?.language ?? '') || localeLanguageName('it');

  try {
    const saved = await withBrandContext(brand.id, async () => {
      const [profile, evidence, gtmBrief] = await Promise.all([
        plannerProfile(supabase, brand),
        planEvidence(supabase, brand.id),
        activeGtmBrief(supabase, brand.id, String(brand.timezone ?? 'Europe/Rome')).catch((error) => { swallow('String failed', error); return ''; })
      ]);
      const candidates = await proposeRubrics(genaiClient(), profile, {
        platforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
        outputLanguage,
        strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
        benchmark: evidence.benchmark
      });
      if (!candidates.length) throw new Error('No rubric candidates generated');
      return saveProposedRubrics(supabase, brand.id, candidates);
    });
    return json({ ok: true, proposed: saved });
  } catch (e) {
    return json({ error: `Propose failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
};
