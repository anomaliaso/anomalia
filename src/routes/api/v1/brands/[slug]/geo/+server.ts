import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { getGeo } from '$lib/server/cli-queries';
import { withBrandContext } from '$lib/server/ai-log';
import { createAdminClient } from '$lib/server/supabase-admin';

// Grounded citation probes are slow — same budget the /app/[brand]/geo page gives its actions.
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

  return json(await getGeo(supabase, brand.id));
};

// POST { action: 'audit' | 'fix' }
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const { action = 'audit' } = await request.json().catch(() => ({})) as { action?: string };

  return withBrandContext(brand.id, async () => {
    const admin = createAdminClient();

    if (action === 'audit') {
      const { geoTickForBrand } = await import('$lib/server/geo');
      const snapshot = await geoTickForBrand(admin, brand);
      if (!snapshot) return json({ error: 'Audit failed — site unreachable or no prompts' }, { status: 502 });
      return json({
        ok: true,
        techScore: snapshot.techScore,
        shareOfVoice: snapshot.shareOfVoice,
        // Being named and being linked are two different events with different fixes.
        domainCitedShare: snapshot.domainCitedShare,
        citabilityScore: snapshot.citabilityScore,
        bindingConstraint: snapshot.bindingConstraint
      });
    }

    if (action === 'fix') {
      // Rebuild the snapshot generateGeoArtifacts needs from the latest stored audit.
      const { data: audit } = await supabase
        .from('brand_geo_audits').select('tech_score, tech, share_of_voice, citations')
        .eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!audit) return json({ error: 'Run an audit first' }, { status: 400 });

      const tech = (audit.tech ?? {}) as { issues?: unknown[] };
      const { generateGeoArtifacts } = await import('$lib/server/geo-artifacts');
      const n = await generateGeoArtifacts(admin, brand, {
        techScore: audit.tech_score,
        shareOfVoice: audit.share_of_voice ?? 0,
        issues: tech.issues ?? [],
        citations: audit.citations ?? []
      } as never);
      if (!n) return json({ error: 'Nothing to generate — no addressable gaps' }, { status: 502 });
      return json({ ok: true, generated: n });
    }

    return json({ error: `Unknown action: ${action}` }, { status: 400 });
  });
};
