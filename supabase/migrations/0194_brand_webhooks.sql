-- 0194 — Outbound webhooks: a brand's own endpoint, fed by Composio triggers.
--
-- Composio delivers every trigger event to one URL per project — ours. A brand cannot be given
-- to Composio as a destination, so we are the fan-out: verify Composio's signature on the way
-- in, then deliver to the brand's endpoint with a signature of our own, retries, and a log.

create table if not exists public.brand_webhooks (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  url text not null,
  -- Shared with the brand once, at creation: they verify our HMAC with it.
  secret text not null,
  -- Trigger slugs this endpoint wants. Empty means every event we receive for the brand.
  events text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'paused', 'failing')),
  failure_count integer not null default 0,
  last_delivery_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id)
);

alter table public.brand_webhooks enable row level security;
create policy "brand webhooks via brand" on public.brand_webhooks for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- One row per Composio trigger instance we created, so we can delete them again: an orphaned
-- instance keeps firing into our ingress for a connection the brand already dropped.
create table if not exists public.brand_triggers (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  toolkit_slug text not null,
  trigger_slug text not null,
  trigger_instance_id text not null,
  config jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, trigger_slug, trigger_instance_id)
);

create index if not exists brand_triggers_brand_idx on public.brand_triggers (brand_id);

alter table public.brand_triggers enable row level security;
create policy "brand triggers via brand" on public.brand_triggers for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Every attempt is recorded: "it never arrived" is undebuggable without one of these.
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  webhook_id uuid references public.brand_webhooks(id) on delete cascade,
  event_id text not null,
  trigger_slug text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  response_status integer,
  error text,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

-- The worker claims by (status, next_attempt_at); the brand reads its own log by recency.
create index if not exists webhook_deliveries_pending_idx
  on public.webhook_deliveries (next_attempt_at)
  where status = 'pending';
create index if not exists webhook_deliveries_brand_idx
  on public.webhook_deliveries (brand_id, created_at desc);

-- Composio can retry a delivery; the same event must not fan out twice.
create unique index if not exists webhook_deliveries_event_idx
  on public.webhook_deliveries (brand_id, event_id);

alter table public.webhook_deliveries enable row level security;
create policy "webhook deliveries via brand" on public.webhook_deliveries for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
