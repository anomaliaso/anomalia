import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { getSeo } from '$lib/server/cli-queries';
import { withBrandContext } from '$lib/server/ai-log';
import { createAdminClient } from '$lib/server/supabase-admin';

// Grounded SEO calls are slow — same budget the /app/[brand]/seo page gives its actions.
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

  return json(await getSeo(supabase, brand.id));
};

// POST { action: 'audit' | 'plan' | 'more' | 'asset' | 'article', initiativeId?, guidance? }
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const { action = 'audit', initiativeId, guidance } = await request.json().catch(() => ({})) as
    { action?: string; initiativeId?: string; guidance?: string };

  return withBrandContext(brand.id, async () => {
    const admin = createAdminClient();

    if (action === 'audit') {
      const { geoTickForBrand } = await import('$lib/server/geo');
      const snapshot = await geoTickForBrand(admin, brand);
      if (!snapshot) return json({ error: 'Audit failed — site unreachable or no prompts' }, { status: 502 });
      // The plan is a best-effort follow-up; the audit is the primary result.
      const { generateSeoPlan } = await import('$lib/server/seo-advisor');
      await generateSeoPlan(admin, brand).catch((error) => { swallow('generate seo plan', error); return null; });
      return json({ ok: true, techScore: snapshot.techScore ?? null });
    }

    if (action === 'plan') {
      const { generateSeoPlan } = await import('$lib/server/seo-advisor');
      const plan = await generateSeoPlan(admin, brand);
      if (!plan) return json({ error: 'Could not generate the SEO plan' }, { status: 502 });
      return json({ ok: true, grade: plan.evaluation.grade, initiatives: plan.initiatives.length });
    }

    if (action === 'more') {
      const { addSeoInitiatives } = await import('$lib/server/seo-advisor');
      const fresh = await addSeoInitiatives(admin, brand, { guidance: (guidance ?? '').slice(0, 500) });
      if (!fresh?.length) return json({ error: 'Could not add initiatives' }, { status: 502 });
      return json({ ok: true, added: fresh.length });
    }

    if (!initiativeId) return json({ error: 'Missing initiativeId' }, { status: 400 });

    if (action === 'asset') {
      const { generateSeoAsset } = await import('$lib/server/seo-advisor');
      const n = await generateSeoAsset(admin, brand, initiativeId);
      if (!n) return json({ error: 'Could not generate the asset' }, { status: 502 });
      return json({ ok: true, generated: n });
    }

    if (action === 'article') {
      const { generateArticle } = await import('$lib/server/blog-generate');
      const id = await generateArticle(admin, brand, initiativeId);
      if (!id) return json({ error: 'Could not generate the article' }, { status: 502 });
      return json({ ok: true, articleId: id });
    }

    return json({ error: `Unknown action: ${action}` }, { status: 400 });
  });
};
