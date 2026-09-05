-- Brand-free AI spend, step A: schema only. Nothing writes org_id yet — the code that does
-- arrives with the brand-free generators.
--
-- Today every metered call carries a brand, and the org's spend is the sum of its brands'.
-- A render asked for without a brand has no brand to carry, so it logs brand_id null — and
-- sum_org_ai_cost_usd joins THROUGH brands, which means such a row sums to zero for every org.
-- The quota would never see it and the gate above it would pass forever.
--
--   with a brand   →  ai_calls.brand_id → brands.org_id → the pool
--   without one    →  ai_calls.org_id ─────────────────→ the same pool
--
-- Two ways in, one pool. org_id stays null on branded rows: the brand join already answers for
-- them, and writing both would invite the two answers to disagree.

alter table public.ai_calls
  add column if not exists org_id uuid references public.organizations (id);

-- The org sum now also scans rows that have no brand to join through.
create index if not exists ai_calls_org_created_idx
  on public.ai_calls (org_id, created_at desc)
  where org_id is not null;

-- Same function as 20260903190000, with the join made outer so a brand-free row survives it.
-- coalesce picks the brand's org when there is a brand, the row's own org when there is not.
create or replace function public.sum_org_ai_cost_usd(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(c.cost_usd), 0)::numeric
  from public.ai_calls c
  left join public.brands b on b.id = c.brand_id
  where coalesce(b.org_id, c.org_id) = p_org_id
    and c.created_at >= p_start
    and c.created_at < p_end
    and c.cost_usd is not null
    and (
      auth.role() = 'service_role'
      or p_org_id in (select public.auth_org_ids())
    );
$$;

revoke execute on function public.sum_org_ai_cost_usd(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.sum_org_ai_cost_usd(uuid, timestamptz, timestamptz) to authenticated, service_role;
