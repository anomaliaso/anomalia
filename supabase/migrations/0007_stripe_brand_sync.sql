-- 0007: per-brand Stripe (brand -> customer -> subscription) + live-sync trigger.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-03 via MCP.
alter table public.brands add column if not exists stripe_customer_id text;
create index if not exists brands_stripe_customer_idx on public.brands (stripe_customer_id);

-- SELF-HOST: lo schema `stripe` lo crea il webhook del prodotto hosted e su un Supabase proprio
-- non esiste. Colonne minime che trigger e viste dei migration successivi (0075, 0089) compilano:
-- con BILLING_PROVIDER=open nessuno ci scrive mai, ma il SQL resta vero.
create schema if not exists stripe;
create table if not exists stripe.subscriptions (
  id text primary key,
  customer text,
  status text,
  metadata jsonb,
  items jsonb,
  plan jsonb,
  -- epoch bigint, non timestamptz: le viste successive li coforzano con items->current_period_*.
  current_period_start bigint,
  current_period_end bigint,
  billing_cycle_anchor bigint
);

create or replace function public.sync_brand_from_stripe_subscription() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update public.brands b set
    stripe_subscription_id = NEW.id,
    plan = coalesce(NEW.metadata->>'plan', b.plan),
    status = case
      when NEW.status in ('active','trialing') then 'active'::brand_status
      when NEW.status in ('past_due','unpaid','incomplete') then 'paused'::brand_status
      else 'canceled'::brand_status end,
    activated_at = case when NEW.status in ('active','trialing') and b.activated_at is null then now() else b.activated_at end
  where b.stripe_customer_id = NEW.customer;
  return NEW;
end; $$;

drop trigger if exists trg_sync_brand_from_sub on stripe.subscriptions;
create trigger trg_sync_brand_from_sub
  after insert or update on stripe.subscriptions
  for each row execute function public.sync_brand_from_stripe_subscription();
