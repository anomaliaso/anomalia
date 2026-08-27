import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { canApplyGeoLoop, reprobeGeoOpportunities } from '$lib/server/geo-opportunities';
import { hasWebHub } from '$lib/plans';

export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const only = new URL(request.url).searchParams.get('brand');

  // Prefer brands with applied opportunities due soon — oldest applied first.
  let oppQ = admin
    .from('brand_geo_opportunities')
    .select('brand_id')
    .eq('status', 'applied')
    .order('applied_at', { ascending: true })
    .limit(40);
  if (only) {
    const { data: b } = await admin.from('brands').select('id').eq('slug', only).maybeSingle();
    if (!b) {
      return new Response(JSON.stringify({ ok: true, brands: 0, reprobed: 0, won: 0, deferred: 0 }), {
        headers: { 'content-type': 'application/json' }
      });
    }
    oppQ = oppQ.eq('brand_id', b.id);
  }
  const { data: oppRows } = await oppQ;
  const brandIds = [...new Set((oppRows ?? []).map((r) => r.brand_id as string))];

  let reprobed = 0;
  let won = 0;
  let deferred = 0;
  let brands = 0;

  for (const brandId of brandIds.slice(0, only ? 1 : 12)) {
    const { data: brand } = await admin
      .from('brands')
      .select('id, name, slug, website, plan, content_prefs, status')
      .eq('id', brandId)
      .maybeSingle();
    if (!brand || brand.status !== 'active') continue;
    if (!hasWebHub(brand.plan) || !canApplyGeoLoop(brand.plan)) continue;
    try {
      const res = await reprobeGeoOpportunities(admin, brand);
      reprobed += res.reprobed;
      won += res.won;
      deferred += res.deferred;
      brands++;
    } catch (e) {
      console.error('[geo/reprobe/tick]', brand.slug, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify({ ok: true, brands, reprobed, won, deferred }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
