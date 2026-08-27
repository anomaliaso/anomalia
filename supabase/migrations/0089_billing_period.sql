-- 0089: AI credits plumbing.
-- The billing period is read DYNAMICALLY from the synced stripe.subscriptions table via a
-- security-definer function — no duplicated period columns on brands, no trigger changes,
-- no backfill, single source of truth. Plus: the SELECT policy ai_calls never had (RLS is
-- enabled with zero policies, so the credits counter summed nothing), and the anti-spam
-- flag for the >80% warning email.

-- 1. Anti-spam flag on brand_usage: one credit-warning email per billing period.
alter table public.brand_usage
  add column if not exists credits_warned_at timestamptz;

-- 2. Billing period, read live from the Stripe schema. SECURITY DEFINER because the stripe
--    schema is not exposed to client roles; callers must already have access to the brand
--    (the credits endpoint proves it via RLS on brands) — this only leaks two dates.
-- Stripe API 2025+ moved current_period_* from the subscription top level to its ITEMS —
-- the top-level columns in stripe.subscriptions are permanently NULL on new API versions.
-- Coalesce item-level → legacy top-level → billing_cycle_anchor. NB: on annual plans the item
-- period spans a YEAR; credits.ts shiftToAnchor() normalises it to the monthly anniversary.
create or replace function public.brand_billing_period(_brand_id uuid)
returns table(period_start timestamptz, period_end timestamptz)
language sql stable security definer set search_path = public, stripe as $$
  select
    to_timestamp(coalesce((s.items->'data'->0->>'current_period_start')::bigint, s.current_period_start, s.billing_cycle_anchor)),
    to_timestamp(coalesce((s.items->'data'->0->>'current_period_end')::bigint, s.current_period_end))
  from public.brands b
  join stripe.subscriptions s on s.id = b.stripe_subscription_id
  where b.id = _brand_id
    and s.status in ('active', 'trialing')
  limit 1;
$$;
grant execute on function public.brand_billing_period(uuid) to authenticated;

-- 3. ai_calls is written by the service role only; brand members may READ their brands' rows
--    so the credits counter (and any future usage dashboard) can sum cost_usd client-side of RLS.
drop policy if exists "ai_calls readable by brand members" on public.ai_calls;
create policy "ai_calls readable by brand members" on public.ai_calls
  for select using (brand_id in (select public.auth_brand_ids()));
