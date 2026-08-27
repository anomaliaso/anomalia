-- 0005 social: per-brand connected accounts (Zernio). Isolation = per-brand profileId.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-03 via MCP.
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  zernio_account_id text not null,
  platform text, username text, display_name text, profile_url text,
  status text not null default 'active', auto_publish boolean not null default false,
  connected_at timestamptz not null default now(),
  unique (brand_id, zernio_account_id)
);
create index social_accounts_brand_idx on public.social_accounts (brand_id);
alter table public.social_accounts enable row level security;
create policy "social_accounts via brand" on public.social_accounts for all
  using (brand_id in (select public.auth_brand_ids())) with check (brand_id in (select public.auth_brand_ids()));
