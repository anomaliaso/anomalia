import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { withBrandContext } from '$lib/server/ai-log';
import { adsFeatureEnabled, adsAvailable, pauseLiveCampaigns, syncAdMetrics } from '$lib/server/ads';
import { getCreditsUsage } from '$lib/server/credits';

// Daily ads reconciliation. For every brand with live campaigns:
//   1. pull fresh analytics (syncAdMetrics also BILLS the 12% fee on new spend, delta-based)
//   2. if the brand is now out of credits, pause everything on the platform
// Step 2 is the enforcement half of "running ads consumes credits": without it a campaign would
// keep being managed for free once the balance ran dry.

export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!adsFeatureEnabled()) return Response.json({ skipped: 'feature_off' });

  const admin = createAdminClient();
  const only = new URL(request.url).searchParams.get('brand');

  // Only brands that actually have something live — no reason to walk the whole table.
  const { data: live } = await admin
    .from('ad_campaigns')
    .select('brand_id')
    .in('status', ['active', 'pending_review'])
    .not('zernio_ad_id', 'is', null);
  const brandIds = [...new Set((live ?? []).map((c) => c.brand_id))];
  if (!brandIds.length) return Response.json({ brands: 0 });

  let q = admin
    .from('brands')
    .select('id, slug, plan, status, activated_at')
    .in('id', brandIds);
  if (only) q = q.eq('slug', only);
  const { data: brands } = await q;

  let synced = 0;
  let paused = 0;
  for (const brand of brands ?? []) {
    try {
      // Charging happens inside syncAdMetrics; the brand context keeps the ledger row attributed
      // even for the chokepoints that don't thread brandId.
      synced += await withBrandContext(brand.id, () => syncAdMetrics(admin, brand.id));

      const usage = await getCreditsUsage(admin, {
        id: brand.id,
        plan: brand.plan,
        activated_at: brand.activated_at,
        status: brand.status
      });
      // Losing the plan (downgrade, cancellation) stops ads for the same reason running dry does.
      if (usage.remaining <= 0 || !adsAvailable(brand.plan)) {
        paused += await pauseLiveCampaigns(
          admin,
          brand.id,
          // Distinct from the LAUNCH codes: reusing `credits_exhausted` rendered the launch
          // message ("you need N credits to launch") on a campaign that was just stopped, with an
          // empty N because the auto-pause carries no numbers.
          usage.remaining <= 0 ? 'paused_credits_exhausted' : 'paused_not_on_plan'
        );
      }
    } catch (e) {
      console.warn('[ads/tick] brand failed', brand.slug, e instanceof Error ? e.message : e);
    }
  }

  return Response.json({ brands: brands?.length ?? 0, synced, paused });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
