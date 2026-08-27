import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { getCreditsUsage, maybeSendCreditWarning } from '$lib/server/credits';
import { createAdminClient } from '$lib/server/supabase-admin';

export const GET: RequestHandler = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { session } = await safeGetSession();
  if (!session) return new Response('Unauthorized', { status: 401 });

  // RLS on brands (policy "brands via org") scopes the query to the user's org —
  // a user cannot read another user's brand by guessing the slug.
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, slug, org_id, plan, activated_at, status')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return new Response('Not found', { status: 404 });

  const usage = await getCreditsUsage(supabase, brand);

  // L'avviso all'80% viveva solo dentro il ramo di autopilot RIUSCITO, cioè dopo il `return
  // credits_exhausted` che scatta molto prima: un brand che passa da 60% a 100% tra due run —
  // adesso il caso normale — non lo riceveva mai. Qui ci passano tutti: il layout chiama questa
  // rotta ogni 45s. Client admin perché la deduplica scrive su brand_usage e i contatti stanno
  // dietro RLS che l'utente non attraversa; il dedup è credits_warned_at, una mail per periodo.
  // Fire-and-forget: non deve mai rallentare né rompere il polling.
  if (usage.percent >= 80) {
    void maybeSendCreditWarning(
      createAdminClient(),
      { id: brand.id, name: brand.name, org_id: brand.org_id, plan: brand.plan, slug: brand.slug },
      usage
    ).catch(swallow('createAdminClient failed'));
  }

  return new Response(JSON.stringify({
    used: usage.used,
    bonus: usage.bonus,
    quota: usage.quota,
    remaining: usage.remaining,
    percent: usage.percent,
    periodEnd: usage.periodEnd.toISOString()
  }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
