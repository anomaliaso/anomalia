-- 0131: Ads via Zernio — ad accounts, campaigns (boost + standalone), metrics cache.
-- Spend is always human-approved; Anomalia never takes a cut of ad spend.

-- Brand-level ads preferences (budget caps, default countries/currency).
alter table public.brands
  add column if not exists ads_settings jsonb not null default '{}'::jsonb;

-- Connected platform ad accounts discovered via Zernio GET /v1/ads/accounts.
create table public.zernio_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  social_account_id uuid references public.social_accounts(id) on delete set null,
  zernio_ad_account_id text not null,
  zernio_social_account_id text,
  platform text not null,
  name text,
  currency text,
  status text not null default 'active',
  connected_at timestamptz not null default now(),
  unique (brand_id, zernio_ad_account_id)
);
create index zernio_ad_accounts_brand_idx on public.zernio_ad_accounts (brand_id);
alter table public.zernio_ad_accounts enable row level security;
create policy "zernio_ad_accounts via brand" on public.zernio_ad_accounts for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Boost proposals and live campaigns (Anomalia ↔ Zernio).
-- status: proposed | approved | active | pending_review | paused | completed | failed | rejected
create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  ad_account_id uuid references public.zernio_ad_accounts(id) on delete set null,
  zernio_ad_id text,
  platform text not null,
  ad_type text not null default 'boost',
  name text not null,
  goal text not null default 'engagement',
  budget_amount numeric not null,
  budget_type text not null default 'daily',
  currency text,
  status text not null default 'proposed',
  review_status text,
  targeting jsonb not null default '{}'::jsonb,
  creative jsonb,
  schedule jsonb,
  proposed_by text not null default 'ai',
  proposal_reason text,
  approved_at timestamptz,
  external_ids jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ad_campaigns_brand_idx on public.ad_campaigns (brand_id);
create index ad_campaigns_status_idx on public.ad_campaigns (brand_id, status);
create index ad_campaigns_zernio_idx on public.ad_campaigns (zernio_ad_id) where zernio_ad_id is not null;
alter table public.ad_campaigns enable row level security;
create policy "ad_campaigns via brand" on public.ad_campaigns for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Periodic metrics snapshots from Zernio /v1/ads/{id}/analytics.
create table public.ad_metrics (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  zernio_ad_account_id uuid references public.zernio_ad_accounts(id) on delete set null,
  period_start date not null,
  period_end date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  conversions numeric,
  roas numeric,
  raw jsonb,
  synced_at timestamptz not null default now(),
  unique (campaign_id, period_start, period_end)
);
create index ad_metrics_brand_idx on public.ad_metrics (brand_id);
create index ad_metrics_campaign_idx on public.ad_metrics (campaign_id);
alter table public.ad_metrics enable row level security;
create policy "ad_metrics via brand" on public.ad_metrics for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
