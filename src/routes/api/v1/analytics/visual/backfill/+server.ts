import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { backfillVisualMeta } from '$lib/server/visual-meta';

// One-off historical fill of post_visual_meta (P2 learning loop): published posts without a
// meta row get one derived deterministically from the post row (no LLM cost). Callable via
// cron or manually; ?limit= caps the batch (default 200, max 1000), ?brand=<slug> restricts
// the run to a single brand. Auth same as the other ticks.

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const admin = createAdminClient();
  const url = new URL(request.url);

  const raw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 1000) : 200;

  const brandSlug = url.searchParams.get('brand');
  let brandId: string | undefined;
  if (brandSlug) {
    const { data } = await admin.from('brands').select('id').eq('slug', brandSlug).limit(1);
    const brand = data?.[0];
    if (!brand?.id) {
      return new Response(JSON.stringify({ ok: false, error: `brand not found: ${brandSlug}` }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      });
    }
    brandId = String(brand.id);
  }

  const { backfilled } = await backfillVisualMeta(admin, { limit, brandId });

  return new Response(JSON.stringify({ ok: true, backfilled }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
