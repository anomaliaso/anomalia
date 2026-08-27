import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import {
  pollOpenBacklinkOrders,
  externalBacklinksConfigured,
  brandsWithOpenSfbOrders
} from '$lib/server/backlink-external';
import { hasBacklinkNetwork } from '$lib/plans';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!externalBacklinksConfigured()) {
    return new Response(JSON.stringify({ ok: true, polled: 0, skipped: 'not_configured' }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  const admin = createAdminClient();
  const only = new URL(request.url).searchParams.get('brand');
  let brandIds: string[] = [];
  if (only) {
    const { data: b } = await admin.from('brands').select('id').eq('slug', only).maybeSingle();
    if (b) brandIds = await brandsWithOpenSfbOrders(admin, { brandId: b.id, limitBrands: 1 });
  } else {
    brandIds = await brandsWithOpenSfbOrders(admin, { limitBrands: 12, limitOrders: 40 });
  }

  let polled = 0;
  let brands = 0;
  for (const brandId of brandIds) {
    const { data: brand } = await admin
      .from('brands')
      .select('id, slug, plan, status')
      .eq('id', brandId)
      .maybeSingle();
    if (!brand || brand.status !== 'active') continue;
    if (!hasBacklinkNetwork(brand.plan)) continue;
    try {
      polled += await pollOpenBacklinkOrders(admin, brand.id, 5);
      brands++;
    } catch (e) {
      console.error('[backlinks/external/tick]', brand.slug, e instanceof Error ? e.message : e);
    }
  }
  return new Response(JSON.stringify({ ok: true, brands, polled }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
