-- When a Stripe subscription is no longer active/trialing, clear brands.plan so
-- free-tier gates (canConnectSocials / isPaidPlan) treat the brand as unpaid.
-- Active + past_due keep their plan; canceled/incomplete_expired/etc. drop it.

create or replace function public.sync_brand_from_stripe_subscription() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  _price_id text;
  _plan text;
  _status brand_status;
begin
  _price_id := NEW.items->'data'->0->'price'->>'id';
  _plan := public.plan_from_price_id(_price_id);

  _status := case
    when NEW.status in ('active','trialing') then 'active'::brand_status
    when NEW.status in ('past_due','unpaid','incomplete') then 'paused'::brand_status
    else 'canceled'::brand_status
  end;

  update public.brands b set
    stripe_subscription_id = NEW.id,
    -- Paid status keeps derived plan; canceled/paused without recovery clears it.
    plan = case
      when _status = 'active' then coalesce(_plan, NEW.metadata->>'plan', b.plan)
      when _status = 'paused' then coalesce(_plan, NEW.metadata->>'plan', b.plan)
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

-- Backfill: brands already canceled should not keep a paid plan label.
update public.brands
set plan = null
where status = 'canceled'
  and plan is not null;
