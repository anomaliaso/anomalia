import { swallow } from '$lib/server/swallow';
import { env } from '$env/dynamic/private';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { createAdminClient } from '$lib/server/supabase-admin';
import { loadGscSummary, gscReadyFromSummary } from '$lib/server/gsc';
import { loadLatestCrawl } from '$lib/server/site-crawl';
import { listSitePages } from '$lib/server/site-pages';
import { buildSeoMetrics } from '$lib/server/seo-metrics';
import { isGscGateEnabled } from '$lib/server/feature-flags';
import { cachedBrandPage } from '$lib/server/page-cache';

// SEO: technical crawl + search performance + growth plan. Audit runs tech + search (and still
// probes citations under the hood); this page only surfaces SEO-relevant data. Grounded calls take
// a while → give the actions room beyond the platform default.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const admin = createAdminClient();

    const [{ data: geoRows }, { data: allArtifacts }, { data: seoPlan }, { data: articles }, gsc, crawl, sitePages] =
      await Promise.all([
      supabase
        .from('brand_geo_audits')
        .select('tech_score, tech, search, backlinks, ai_overview, created_at')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false })
        .limit(12),
      // SEO growth assets are tagged source_finding 'seo:<id>' and shown under their initiative.
      supabase
        .from('brand_geo_artifacts')
        .select('id, kind, title, format, body, blocks, target_path, source_finding')
        .eq('brand_id', brand.id)
        .eq('status', 'draft')
        .order('created_at', { ascending: false }),
      supabase
        .from('brand_seo_plans')
        .select('grade, evaluation, initiatives, created_at')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('brand_articles')
        .select('id, slug, title, meta_title, meta_description, status, source_initiative_id, created_at')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false }),
      loadGscSummary(admin, brand.id),
      loadLatestCrawl(admin, brand.id),
      listSitePages(admin, brand.id)
    ]);

    // Prefer the latest audit that actually has tech data (the site might be unreachable on the
    // latest run). Fall back to the most recent row overall.
    const geo = (geoRows ?? []).find((r) => r.tech != null) ?? geoRows?.[0] ?? null;

    // Latest asset per initiative id (drafts are replaced on regen, but guard anyway).
    const seoAssets: Record<string, NonNullable<typeof allArtifacts>[number]> = {};
    for (const a of allArtifacts ?? []) {
      const sf = String(a.source_finding ?? '');
      if (sf.startsWith('seo:')) { const id = sf.slice(4); if (!seoAssets[id]) seoAssets[id] = a; }
    }

    return {
      geo,
      seoPlan: seoPlan ?? null,
      seoAssets,
      articles: articles ?? [],
      seoMetrics: buildSeoMetrics(geoRows ?? []),
      gsc,
      crawl,
      sitePages,
      gscGate: isGscGateEnabled(),
      gscReady: gscReadyFromSummary(gsc)
    };
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandBySlug(supabase: any, slug: string) {
  const { data } = await supabase.from('brands').select('id').eq('slug', slug).maybeSingle();
  return data;
}

export const actions: Actions = {
  // Run the audit on demand (tech + search) and store a snapshot. Ownership via the RLS client; the
  // tick writes with the admin client (brand_geo_audits is SELECT-only under RLS).
  geoRunNow: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    return withBrandContext(brand.id, async () => {
    const { data: full } = await supabase.from('brands').select('id, name, website, content_prefs').eq('id', brand.id).maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { geoTickForBrand } = await import('$lib/server/geo');
    const snapshot = await geoTickForBrand(createAdminClient(), full);
    if (!snapshot) return fail(502, { error: 'Audit failed — site unreachable or no prompts' });
    // Also generate the SEO plan (best-effort — geo audit already saved).
    try {
      const { generateSeoPlan } = await import('$lib/server/seo-advisor');
      await generateSeoPlan(createAdminClient(), full);
    } catch (error) { swallow('generate seo plan', error); }
    return { geoRan: true };
    });
  },

  // Phase 1: generate the SEO growth plan (qualitative evaluation + prioritized initiatives).
  seoPlanRun: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    return withBrandContext(brand.id, async () => {
    const { data: full } = await supabase.from('brands').select('id, name, website, content_prefs').eq('id', brand.id).maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });

    const { isGscGateEnabled } = await import('$lib/server/feature-flags');
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const admin = createAdminClient();
    if (isGscGateEnabled()) {
      const { gscConfigured, loadGscReady } = await import('$lib/server/gsc');
      if (gscConfigured()) {
        const { ready } = await loadGscReady(admin, brand.id);
        if (!ready) {
          const fd = await request.formData();
          const confirmed = String(fd.get('confirm_estimates') ?? '') === '1';
          if (!confirmed) {
            return fail(400, {
              error:
                'Connect and sync Google Search Console for a serious SEO plan, or confirm “continue with estimates”.',
              gscRequired: true
            });
          }
        }
      }
    }

    const { generateSeoPlan } = await import('$lib/server/seo-advisor');
    const plan = await generateSeoPlan(admin, full);
    if (!plan) return fail(502, { error: 'Could not generate the SEO plan' });
    return { seoPlanRan: true };
    });
  },

  // Phase 2: turn one initiative into a ready asset (blog outline / landing / tool spec).
  seoGenerateAsset: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    return withBrandContext(brand.id, async () => {
    const { data: full } = await supabase.from('brands').select('id, name, website, content_prefs').eq('id', brand.id).maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });
    const initiativeId = String((await request.formData()).get('initiativeId') ?? '');
    if (!initiativeId) return fail(400, { error: 'Missing initiative' });
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { generateSeoAsset } = await import('$lib/server/seo-advisor');
    const n = await generateSeoAsset(createAdminClient(), full, initiativeId);
    if (!n) return fail(502, { error: 'Could not generate the asset' });
    return { seoAssetGenerated: true };
    });
  },

  // Add MORE initiatives (append to the existing plan), optionally steered by a user hint.
  seoMoreInitiatives: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    return withBrandContext(brand.id, async () => {
    const { data: full } = await supabase.from('brands').select('id, name, website, content_prefs').eq('id', brand.id).maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });
    const guidance = String((await request.formData()).get('guidance') ?? '').slice(0, 500);
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { addSeoInitiatives } = await import('$lib/server/seo-advisor');
    const fresh = await addSeoInitiatives(createAdminClient(), full, { guidance });
    if (!fresh?.length) return fail(502, { error: 'Could not add initiatives' });
    return { seoInitiativesAdded: fresh.length };
    });
  },

  // A user wants to talk to a human expert about a specific initiative: save their contact details
  // and email the team (both addresses) so we can call them back. The DB row is the source of truth;
  // the email is best-effort.
  requestExpert: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const fullName = String(fd.get('full_name') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    const phone = String(fd.get('phone') ?? '').trim();
    const initiativeId = String(fd.get('initiativeId') ?? '');
    const initiativeTitle = String(fd.get('initiativeTitle') ?? '');
    const initiativeType = String(fd.get('initiativeType') ?? '');
    if (!fullName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone) return fail(400, { error: 'invalid' });

    const { error } = await supabase.from('expert_requests').insert({
      brand_id: brand.id, initiative_id: initiativeId || null, initiative_title: initiativeTitle || null,
      initiative_type: initiativeType || null, full_name: fullName, email, phone
    });
    if (error) return fail(500, { error: error.message });

    try {
      const { data: b } = await supabase.from('brands').select('name, slug').eq('id', brand.id).maybeSingle();
      const { sendEmail } = await import('$lib/server/email');
      const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<div style="font-family:sans-serif;max-width:520px;">
        <h2 style="margin:0 0 12px;">🧑‍💻 Nuova richiesta esperto SEO</h2>
        <p><b>Brand:</b> ${esc(b?.name)} (${esc(b?.slug)})</p>
        <p><b>Iniziativa:</b> ${esc(initiativeTitle) || '—'}${initiativeType ? ` <span style="color:#888;">(${esc(initiativeType)})</span>` : ''}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:14px 0;" />
        <p><b>Nome:</b> ${esc(fullName)}</p>
        <p><b>Email:</b> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
        <p><b>Telefono:</b> <a href="tel:${esc(phone)}">${esc(phone)}</a></p>
      </div>`;
      const text = `Nuova richiesta esperto SEO\nBrand: ${b?.name} (${b?.slug})\nIniziativa: ${initiativeTitle} ${initiativeType}\nNome: ${fullName}\nEmail: ${email}\nTelefono: ${phone}`;
      const subject = `🧑‍💻 Richiesta esperto SEO — ${b?.name ?? ''}`;
      for (const to of (env.INTERNAL_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
        await sendEmail({ to, subject, html, text }).catch(swallow('send email'));
      }
    } catch (error) { swallow('send expert request emails', error); }

    return { expertRequested: true };
  },

  // Phase 0: turn one 'blog' initiative into a FULL article draft (brand_articles), grounded in the
  // brand's voice + its own indexed pages. Admin client — brand_articles is SELECT-only under RLS.
  articleGenerate: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    return withBrandContext(brand.id, async () => {
    const { data: full } = await supabase.from('brands').select('id, name, website, content_prefs').eq('id', brand.id).maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });
    const initiativeId = String((await request.formData()).get('initiativeId') ?? '');
    if (!initiativeId) return fail(400, { error: 'Missing initiative' });
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { generateArticle } = await import('$lib/server/blog-generate');
    const id = await generateArticle(createAdminClient(), full, initiativeId);
    if (!id) return fail(502, { error: 'Could not generate the article' });
    return { articleGenerated: true };
    });
  },

  // Publish an article to the hosted site (or pull it back to draft). Admin client — brand_articles
  // is SELECT-only under RLS.
  articleSetStatus: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const publish = String(fd.get('publish') ?? '') === 'true';
    if (!id) return fail(400, { error: 'Missing id' });
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { error } = await createAdminClient().from('brand_articles')
      .update({ status: publish ? 'published' : 'draft', published_at: publish ? new Date().toISOString() : null })
      .eq('id', id).eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { articleStatusSet: true };
  },

  // Delete an article draft. Admin client (brand_articles has no delete policy under RLS).
  articleDelete: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { error } = await createAdminClient().from('brand_articles').delete().eq('id', id).eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { articleDeleted: true };
  },

  crawlNow: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const { data: full } = await supabase
      .from('brands')
      .select('id, name, website, plan, content_prefs')
      .eq('id', brand.id)
      .maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });
    try {
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { crawlForSeo } = await import('$lib/server/site-crawl');
      const summary = await crawlForSeo(createAdminClient(), full);
      return { crawled: true, summary };
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Crawl failed' });
    }
  },

  publishSitePage: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const initiativeId = String(fd.get('initiativeId') ?? '');
    const kind = String(fd.get('kind') ?? 'landing_page');
    const targetQuery = String(fd.get('targetQuery') ?? '').trim() || null;
    if (!initiativeId) return fail(400, { error: 'Missing initiative' });
    const { data: full } = await supabase
      .from('brands')
      .select('id, name, website, plan, content_prefs')
      .eq('id', brand.id)
      .maybeSingle();
    if (!full) return fail(404, { error: 'Brand not found' });
    try {
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const { publishSeoAssetToSite } = await import('$lib/server/site-pages');
      const page = await publishSeoAssetToSite(createAdminClient(), full, initiativeId, kind, targetQuery);
      return {
        sitePagePublished: true,
        slug: page.slug,
        targetQuery: page.target_query,
        url: page.publicUrl
      };
    } catch (e) {
      return fail(402, { error: e instanceof Error ? e.message : 'Publish failed' });
    }
  }
};
