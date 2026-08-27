import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { cachedBrandPage } from '$lib/server/page-cache';

// GEO: AI visibility / citations audit + copy-paste fix artifacts.
// Grounded citation probes take a while → give the actions room beyond the platform default.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const [{ data: geoRows }, { data: allArtifacts }] = await Promise.all([
      supabase
        .from('brand_geo_audits')
        .select('tech_score, tech, share_of_voice, citations, search, ai_overview, created_at')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false })
        .limit(8),
      // Draft artifacts live in one table; SEO growth assets are tagged source_finding 'seo:<id>' —
      // keep them out of the GEO fixes list.
      supabase
        .from('brand_geo_artifacts')
        .select('id, kind, title, format, body, blocks, target_path, source_finding')
        .eq('brand_id', brand.id)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
    ]);

    // Prefer the latest audit that actually has tech data (the site might be unreachable on the
    // latest run, producing a citation-only row). Fall back to the most recent row overall.
    const geo = (geoRows ?? []).find((r) => r.tech != null) ?? geoRows?.[0] ?? null;
    // The AI Overview panel lives on its own newest-first pick: a citation-only run has no
    // ai_overview, and falling back to `geo` would blank the panel on those weeks.
    const aiOverview = (geoRows ?? []).find((r) => r.ai_overview != null)?.ai_overview ?? null;

    const geoTrend = (geoRows ?? [])
      .map((r) => ({ techScore: r.tech_score, shareOfVoice: r.share_of_voice, at: r.created_at }))
      .reverse();

    const geoArtifacts = (allArtifacts ?? []).filter((a) => !String(a.source_finding ?? '').startsWith('seo:'));

    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { loadGeoOpportunities } = await import('$lib/server/geo-opportunities');
    const { measuredCitationEngines } = await import('$lib/server/geo');
    const opp = await loadGeoOpportunities(createAdminClient(), brand.id);

    return {
      geo,
      geoTrend,
      geoArtifacts,
      aiOverview,
      brandName: brand.name,
      opportunities: opp.opportunities,
      winRate: opp.winRate,
      openOppCount: opp.openCount,
      measuredEngines: measuredCitationEngines()
    };
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandBySlug(supabase: any, slug: string) {
  const { data } = await supabase.from('brands').select('id').eq('slug', slug).maybeSingle();
  return data;
}

export const actions: Actions = {
  // Run the audit on demand (tech + citation) and store a snapshot. Ownership via the RLS client; the
  // tick writes with the admin client (brand_geo_audits is SELECT-only under RLS).
  geoRunNow: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });

    const { gateCredits, CreditsExhaustedError } = await import('$lib/server/credits');
    try {
      await gateCredits(brand.id);
    } catch (e) {
      if (e instanceof CreditsExhaustedError) {
        return fail(402, { error: 'credits_exhausted' });
      }
      throw e;
    }

    return withBrandContext(brand.id, async () => {
      const { data: full } = await supabase
        .from('brands')
        .select('id, name, website, content_prefs')
        .eq('id', brand.id)
        .maybeSingle();
      if (!full) return fail(404, { error: 'Brand not found' });
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { geoTickForBrand } = await import('$lib/server/geo');
      const snapshot = await geoTickForBrand(createAdminClient(), full);
      if (!snapshot) return fail(502, { error: 'Audit failed — site unreachable or no prompts' });
      return { geoRan: true };
    });
  },

  // Generate the fix artifacts for the gaps the latest audit found. Rebuilds the snapshot from the
  // stored audit; writes drafts via the admin client.
  geoGenerateArtifacts: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    return withBrandContext(brand.id, async () => {
      const { data: full } = await supabase.from('brands').select('id, name, website').eq('id', brand.id).maybeSingle();
      const { data: audit } = await supabase
        .from('brand_geo_audits')
        .select('tech_score, tech, share_of_voice, citations')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!full || !audit) return fail(400, { error: 'Run an audit first' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tech = (audit.tech as any) ?? {};
      const snapshot = {
        techScore: audit.tech_score,
        shareOfVoice: audit.share_of_voice ?? 0,
        issues: tech.issues ?? [],
        citations: (audit.citations as unknown[]) ?? []
      };
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { generateGeoArtifacts } = await import('$lib/server/geo-artifacts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = await generateGeoArtifacts(createAdminClient(), full, snapshot as any);
      if (!n) return fail(502, { error: 'Nothing to generate — no addressable gaps' });
      return { geoArtifactsGenerated: n };
    });
  },

  // Dismiss one artifact (RLS client — the artifacts policy allows the owner to update).
  geoDismissArtifact: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    const { error } = await supabase
      .from('brand_geo_artifacts')
      .update({ status: 'dismissed' })
      .eq('id', id)
      .eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { dismissed: true };
  },

  applyOpportunity: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const { data: full } = await supabase
      .from('brands')
      .select('id, name, website, plan, content_prefs')
      .eq('id', brand.id)
      .maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });
    return withBrandContext(brand.id, async () => {
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { applyGeoOpportunity } = await import('$lib/server/geo-opportunities');
      const res = await applyGeoOpportunity(createAdminClient(), full, id);
      if (!res.ok) return fail(402, { error: res.error ?? 'Apply failed' });
      return { opportunityApplied: true, targetUrl: res.targetUrl ?? null };
    });
  },

  dismissOpportunity: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { dismissGeoOpportunity } = await import('$lib/server/geo-opportunities');
    await dismissGeoOpportunity(createAdminClient(), brand.id, id);
    return { opportunityDismissed: true };
  }
};
