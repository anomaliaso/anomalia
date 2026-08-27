import { fail, redirect } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import {
  gscConfigured,
  loadGscSummary,
  listGscSites,
  rankGscSites,
  gscSiteMatchesWebsite,
  setGscSiteUrl,
  syncGscMetrics,
  disconnectGsc,
  type GscSite
} from '$lib/server/gsc';

export const load: PageServerLoad = async ({ parent, url }) => {
  const { brand } = await parent();
  const admin = createAdminClient();
  const summary = await loadGscSummary(admin, brand.id);
  let sites: GscSite[] = [];
  let sitesError: string | null = null;
  if (summary.connected) {
    try {
      sites = rankGscSites(
        await listGscSites(admin, brand.id),
        brand.website,
        summary.siteUrl
      );
    } catch (e) {
      sitesError = e instanceof Error ? e.message : 'Could not load Search Console properties';
    }
  }
  const suggestedSiteUrl =
    sites.find((s) => gscSiteMatchesWebsite(s.siteUrl, brand.website))?.siteUrl ?? null;
  return {
    summary,
    sites,
    sitesError,
    suggestedSiteUrl,
    configured: gscConfigured(),
    connectedFlash: url.searchParams.get('connected') === '1',
    errorFlash: url.searchParams.get('error')
  };
};

async function brandBySlug(supabase: SupabaseClient, slug: string) {
  const { data: brand } = await supabase.from('brands').select('id, slug').eq('slug', slug).maybeSingle();
  return brand;
}

export const actions: Actions = {
  selectSite: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const siteUrl = String(fd.get('site_url') ?? '').trim();
    const permission = String(fd.get('permission_level') ?? '').trim() || undefined;
    if (!siteUrl) return fail(400, { error: 'Pick a property' });
    const admin = createAdminClient();
    await setGscSiteUrl(admin, brand.id, siteUrl, permission);
    try {
      await syncGscMetrics(admin, brand.id, { days: 28 });
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Sync failed' });
    }
    return { saved: true };
  },
  sync: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    try {
      await syncGscMetrics(createAdminClient(), brand.id, { days: 3 });
      return { synced: true };
    } catch (e) {
      return fail(502, { error: e instanceof Error ? e.message : 'Sync failed' });
    }
  },
  disconnect: async ({ params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    await disconnectGsc(createAdminClient(), brand.id);
    throw redirect(303, `/app/${brand.slug}/settings/search-console`);
  }
};
