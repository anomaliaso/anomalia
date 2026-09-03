-- Org-level billing, step A: schema only. Nothing reads these columns yet — the application
-- code that does arrives in the follow-up steps (credits/gating, settings-actions, UI).
--
-- Today one Stripe subscription belongs to one BRAND. The destination is one subscription per
-- ORGANIZATION covering every brand under it, with a shared credit pool. The rollout is
-- org-by-org, so both shapes must work at once: an org is "migrated" exactly when
-- organizations.stripe_customer_id is set, and until then its brands keep answering as before.

-- ── 1. The billing columns, mirrored from brands onto organizations ──────────────
-- Same names and types as brands', so every downstream reader keeps the same shape.
-- stripe_customer_id already exists (0001) and was never used; it becomes the real one.
alter table public.organizations
  add column if not exists stripe_subscription_id text,
  add column if not exists plan text,
  add column if not exists activated_at timestamptz;

create index if not exists organizations_stripe_customer_idx
  on public.organizations (stripe_customer_id);

-- ── 2. The org half of the RLS choke point ───────────────────────────────────────
-- auth_brand_ids() (0001, widened in 0077) answers "which brands are mine". The new org-scoped
-- objects need the same answer one level up. Ownership only: org_members exists but billing has
-- always been owner-only, and this function guards billing rows.
create or replace function public.auth_org_ids() returns setof uuid
  language sql security definer set search_path = public stable as $$
  select id from public.organizations where owner_id = auth.uid();
$$;
revoke execute on function public.auth_org_ids() from public, anon;
grant execute on function public.auth_org_ids() to authenticated;

-- ── 3. The sync trigger becomes org-first, brand-fallback ────────────────────────
-- Same plan/status derivation as 0104, only the target moves. When the customer belongs to a
-- migrated org the billing fields land on the org and the status fans out to all of its brands
-- (one subscription, every brand follows it). When it doesn't, the old per-brand update runs
-- untouched — that is what a not-yet-migrated org looks like.
--
-- A migrated org's brands keep their old stripe_* and plan values FROZEN on purpose: they are
-- the rollback net for the org-by-org rollout, dropped in one final migration at the end.
create or replace function public.sync_brand_from_stripe_subscription() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  _price_id text;
  _plan text;
  _status brand_status;
  _org_id uuid;
begin
  _price_id := NEW.items->'data'->0->'price'->>'id';
  _plan := public.plan_from_price_id(_price_id);

  _status := case
    when NEW.status in ('active','trialing') then 'active'::brand_status
    when NEW.status in ('past_due','unpaid','incomplete') then 'paused'::brand_status
    else 'canceled'::brand_status
  end;

  update public.organizations o set
    stripe_subscription_id = NEW.id,
    plan = case
      when _status in ('active','paused') then coalesce(_plan, NEW.metadata->>'plan', o.plan)
      else null
    end,
    activated_at = case
      when NEW.status in ('active','trialing') and o.activated_at is null then now()
      else o.activated_at
    end
  where o.stripe_customer_id = NEW.customer
  returning o.id into _org_id;

  if _org_id is not null then
    -- The subscription covers every brand in the org, so its status covers them too.
    update public.brands set status = _status where org_id = _org_id;
    return NEW;
  end if;

  update public.brands b set
    stripe_subscription_id = NEW.id,
    plan = case
      when _status in ('active','paused') then coalesce(_plan, NEW.metadata->>'plan', b.plan)
      else null
    end,
    status = _status,
    activated_at = case
      when NEW.status in ('active','trialing') and b.activated_at is null then now()
      else b.activated_at
    end
  where b.stripe_customer_id = NEW.customer;
  return NEW;
end; $$;

-- ── 4. Credit grants can target an org, not just one of its brands ───────────────
-- A grant is either for one brand (traceability: "we gave this brand 500") or for the org as a
-- whole. Exactly one, never both, never neither.
alter table public.credit_grants
  add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.credit_grants
  alter column brand_id drop not null;

alter table public.credit_grants
  drop constraint if exists credit_grants_one_target;
alter table public.credit_grants
  add constraint credit_grants_one_target
  check ((brand_id is null) <> (org_id is null));

create index if not exists credit_grants_org_idx
  on public.credit_grants (org_id);

-- The old policy filtered on brand_id alone, so an org-targeted grant (brand_id null) would be
-- invisible to the very people it belongs to.
drop policy if exists "credit_grants readable by brand members" on public.credit_grants;
create policy "credit_grants readable by brand members" on public.credit_grants
  for select using (
    brand_id in (select public.auth_brand_ids())
    or org_id in (select public.auth_org_ids())
  );

-- ── 5. Billing period, one level up ──────────────────────────────────────────────
-- Twin of brand_billing_period (0089) reading the org's own subscription. Same coalesce chain:
-- Stripe moved current_period_* onto the items, the top-level columns are null on new API
-- versions, and annual plans report a year-long window that credits.ts normalises to the
-- monthly anniversary.
create or replace function public.org_billing_period(_org_id uuid)
returns table(period_start timestamptz, period_end timestamptz)
language sql stable security definer set search_path = public, stripe as $$
  select
    to_timestamp(coalesce((s.items->'data'->0->>'current_period_start')::bigint, s.current_period_start, s.billing_cycle_anchor)),
    to_timestamp(coalesce((s.items->'data'->0->>'current_period_end')::bigint, s.current_period_end))
  from public.organizations o
  join stripe.subscriptions s on s.id = o.stripe_subscription_id
  where o.id = _org_id
    and s.status in ('active', 'trialing')
  limit 1;
$$;
grant execute on function public.org_billing_period(uuid) to authenticated;

-- ── 6. Spend, summed across every brand in the org ───────────────────────────────
-- Twin of sum_brand_ai_cost_usd (0164): the shared pool is the sum of what all the org's brands
-- spent. Same guard — service role, or the caller owns the org.
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
  join public.brands b on b.id = c.brand_id
  where b.org_id = p_org_id
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

-- The org sum walks every brand of the org, so it needs org_id on the join side.
create index if not exists brands_org_id_idx on public.brands (org_id);

-- ── 7. One 80%-warning email per org, not per brand ──────────────────────────────
-- brand_usage stays exactly as it is: it is the per-brand POST/VIDEO quota counter
-- (posts_count, videos_count) that usage.ts and cli-queries.ts read, and post quotas remain a
-- per-brand concept. Only the credit-warning anti-spam flag moves up, so it gets its own small
-- table instead of dragging the counters along.
create table if not exists public.org_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  credits_warned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, month)
);

create index if not exists org_usage_org_month_idx on public.org_usage (org_id, month);

alter table public.org_usage enable row level security;
drop policy if exists "org_usage via org" on public.org_usage;
create policy "org_usage via org" on public.org_usage for all
  using (org_id in (select public.auth_org_ids()))
  with check (org_id in (select public.auth_org_ids()));
