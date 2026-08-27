import { swallow } from '$lib/server/swallow';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { createAdminClient } from '$lib/server/supabase-admin';
import { hasBacklinkNetwork } from '$lib/plans';
import { cachedBrandPage } from '$lib/server/page-cache';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  const build = async () => {
    const { loadBacklinkNetworkSummary } = await import('$lib/server/backlink-network');
    const network = await loadBacklinkNetworkSummary(supabase, brand.id);
    const { listBacklinkOrders, externalBacklinksConfigured } = await import('$lib/server/backlink-external');
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const orders = await listBacklinkOrders(createAdminClient(), brand.id);
    const { data: audit } = await supabase
      .from('brand_geo_audits')
      .select('backlinks, created_at')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      network,
      planAllowed: hasBacklinkNetwork(brand.plan),
      orders,
      dfsBacklinks: audit?.backlinks ?? null,
      sfbConfigured: externalBacklinksConfigured(),
      externalCredits: (await import('$lib/server/backlink-external')).EXTERNAL_BACKLINK_CREDITS
    };
  };

  return cachedBrandPage(event, brand.slug, build);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandBySlug(supabase: any, slug: string) {
  const { data } = await supabase
    .from('brands')
    .select('id, name, website, content_prefs, blog_config, plan')
    .eq('slug', slug)
    .maybeSingle();
  return data;
}

function listingFromForm(fd: FormData) {
  const tagsRaw = String(fd.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    name: String(fd.get('name') ?? '').trim(),
    tagline: String(fd.get('tagline') ?? '').trim(),
    shortDescription: String(fd.get('shortDescription') ?? '').trim(),
    fullDescription: String(fd.get('fullDescription') ?? '').trim(),
    primaryCategorySlug: String(fd.get('primaryCategorySlug') ?? 'productivity').trim() || 'productivity',
    tags: tagsRaw.length ? tagsRaw : ['SaaS'],
    pricingModel: String(fd.get('pricingModel') ?? 'SUBSCRIPTION').trim() || 'SUBSCRIPTION',
    platformType: String(fd.get('platformType') ?? 'WEB').trim() || 'WEB',
    productType: String(fd.get('productType') ?? 'SAAS').trim() || 'SAAS'
  };
}

export const actions: Actions = {
  generate: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    if (!hasBacklinkNetwork(brand.plan)) {
      return fail(402, { error: 'Backlink network requires Starter or above', upgrade: true });
    }
    return withBrandContext(brand.id, async () => {
      const { generateBacklinkOpportunities } = await import('$lib/server/backlink-network');
      const counts = await generateBacklinkOpportunities(createAdminClient(), brand);
      return { generated: true, ...counts };
    });
  },

  toggle: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    if (!hasBacklinkNetwork(brand.plan)) {
      return fail(402, { error: 'Backlink network requires Starter or above', upgrade: true });
    }
    const enabled = String((await request.formData()).get('enabled') ?? '') === 'true';
    const { patchBlogConfig } = await import('$lib/server/blog-settings');
    const { error } = await patchBlogConfig(brand.id, { backlinkNetwork: enabled });
    if (error) return fail(500, { error: error.message });
    return { toggled: enabled };
  },

  dismiss: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    if (!hasBacklinkNetwork(brand.plan)) {
      return fail(402, { error: 'Backlink network requires Starter or above', upgrade: true });
    }
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const admin = createAdminClient();
    const { error } = await admin
      .from('brand_backlink_opportunities')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('brand_id', brand.id);
    if (error) return fail(500, { error: error.message });
    return { dismissed: true };
  },

  createExternalOrder: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    if (!hasBacklinkNetwork(brand.plan)) {
      return fail(402, { error: 'External backlinks require Starter or above', upgrade: true });
    }
    const fd = await request.formData();
    const targetUrl = String(fd.get('target_url') ?? '').trim();
    const topic = String(fd.get('topic') ?? '').trim();
    const mode = String(fd.get('mode') ?? 'manual');
    if (!targetUrl) return fail(400, { error: 'URL required' });
    try {
      const {
        createBacklinkDraft,
        createManualBacklinkOrder,
        externalBacklinksConfigured
      } = await import('$lib/server/backlink-external');
      if (mode === 'sfb') {
        if (!externalBacklinksConfigured()) {
          return fail(503, { error: 'SubmitForBacklinks is not configured on this environment' });
        }
        const order = await createBacklinkDraft(createAdminClient(), brand, {
          targetUrl,
          topic: topic || undefined
        });
        return { draftCreated: true, id: order.id };
      }
      const order = await createManualBacklinkOrder(createAdminClient(), brand, {
        targetUrl,
        topic: topic || undefined
      });
      return { orderCreated: true, id: order.id };
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Order failed' });
    }
  },

  updateDraft: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    try {
      const { updateBacklinkDraft } = await import('$lib/server/backlink-external');
      await updateBacklinkDraft(createAdminClient(), brand.id, id, listingFromForm(fd));
      return { draftUpdated: true };
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Update failed' });
    }
  },

  submitDraft: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const attestations = {
      guidelinesAccepted: String(fd.get('guidelinesAccepted') ?? '') === '1',
      badgeRequirementAcknowledged: String(fd.get('badgeRequirementAcknowledged') ?? '') === '1',
      canRepresentProduct: String(fd.get('canRepresentProduct') ?? '') === '1',
      reviewedGeneratedContent: String(fd.get('reviewedGeneratedContent') ?? '') === '1'
    };
    try {
      // Persist any field edits before finalize
      const { updateBacklinkDraft, submitBacklinkDraft } = await import('$lib/server/backlink-external');
      const listing = listingFromForm(fd);
      if (listing.name) {
        await updateBacklinkDraft(createAdminClient(), brand.id, id, listing).catch((error) => { swallow('createAdminClient failed', error); return null; });
      }
      await withBrandContext(brand.id, async () => {
        await submitBacklinkDraft(createAdminClient(), brand, id, attestations);
      });
      return { draftSubmitted: true };
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Submit failed' });
    }
  },

  completeExternalOrder: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const linksRaw = String(fd.get('links') ?? '');
    const links = linksRaw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((url) => ({ url }));
    if (!id) return fail(400, { error: 'Missing id' });
    try {
      const { completeManualOrder } = await import('$lib/server/backlink-external');
      await completeManualOrder(createAdminClient(), brand.id, id, links);
      return { orderCompleted: true };
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Verify/complete failed' });
    }
  },

  issueBadge: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    try {
      const { issueBacklinkBadge } = await import('$lib/server/backlink-external');
      await issueBacklinkBadge(createAdminClient(), brand.id, id);
      return { badgeIssued: true };
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Badge issue failed' });
    }
  },

  verifyBadge: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const targetUrl = String(fd.get('badge_page_url') ?? '').trim();
    if (!id) return fail(400, { error: 'Missing id' });
    if (!targetUrl) return fail(400, { error: 'Badge page URL required' });
    try {
      const { verifyBacklinkBadge } = await import('$lib/server/backlink-external');
      await verifyBacklinkBadge(createAdminClient(), brand.id, id, targetUrl);
      return { badgeVerified: true };
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Badge verify failed' });
    }
  },

  pollOrder: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    try {
      const { pollBacklinkOrder } = await import('$lib/server/backlink-external');
      await pollBacklinkOrder(createAdminClient(), id, brand.id);
      return { polled: true };
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Poll failed' });
    }
  }
};
