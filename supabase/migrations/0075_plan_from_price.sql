-- 0075: Derive brands.plan from the active Stripe price, not subscription metadata.
-- Metadata can be stale or incorrect (e.g. user opens portal for upgrade but doesn't confirm).
-- The subscription item's price is always the source of truth.

-- Map Stripe price IDs → plan tiers. This is the SQL equivalent of PRICE_TO_PLAN in stripe.ts.
create or replace function public.plan_from_price_id(price_id text) returns text
  language sql immutable as $$
  select case price_id
    -- Starter
    when 'price_1Tfx7NRxN8PTIw40e2md3XM3' then 'starter'
    when 'price_1Tfx7ORxN8PTIw40zbThuICT' then 'starter'
    -- Pro
    when 'price_1Tfx7ORxN8PTIw40yzeFOYaT' then 'pro'
    when 'price_1Tfx7ORxN8PTIw40z42s8aLo' then 'pro'
    -- Scale
    when 'price_1Tfx7PRxN8PTIw402DvZkiFB' then 'scale'
    when 'price_1Tfx7PRxN8PTIw40te7THigm' then 'scale'
    else null
  end;
$$;

-- Updated trigger: derive plan from the first subscription item's price,
-- falling back to metadata only for legacy/unknown price IDs.
create or replace function public.sync_brand_from_stripe_subscription() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  _price_id text;
  _plan text;
begin
  -- Extract the first item's price ID from the JSONB items blob.
  _price_id := NEW.items->'data'->0->'price'->>'id';
  _plan := public.plan_from_price_id(_price_id);

  update public.brands b set
    stripe_subscription_id = NEW.id,
    plan = coalesce(_plan, NEW.metadata->>'plan', b.plan),
    status = case
      when NEW.status in ('active','trialing') then 'active'::brand_status
      when NEW.status in ('past_due','unpaid','incomplete') then 'paused'::brand_status
      else 'canceled'::brand_status end,
    activated_at = case when NEW.status in ('active','trialing') and b.activated_at is null then now() else b.activated_at end
  where b.stripe_customer_id = NEW.customer;
  return NEW;
end; $$;

-- Backfill: fix any brands whose plan is wrong by re-syncing from the current subscription data.
update public.brands b
set plan = public.plan_from_price_id(s.items->'data'->0->'price'->>'id')
from stripe.subscriptions s
where b.stripe_subscription_id = s.id
  and s.status in ('active', 'trialing')
  and public.plan_from_price_id(s.items->'data'->0->'price'->>'id') is not null
  and b.plan is distinct from public.plan_from_price_id(s.items->'data'->0->'price'->>'id');
