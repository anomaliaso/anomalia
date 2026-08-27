-- 0172: demo-account credentials so Browserless can log into a SaaS product and
-- capture authenticated UI (dashboards, app screens) into the Media library.
-- The password is NEVER stored here — it lives in Vault as platform 'demo_account'
-- (reuses upsert/read/delete_integration_secret).

create table if not exists public.brand_demo_accounts (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  login_url text not null,
  username text not null,
  pages jsonb not null default '[]'::jsonb,
  email_selector text,
  password_selector text,
  submit_selector text,
  success_selector text,
  last_harvested_at timestamptz,
  last_harvest_count integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_demo_accounts enable row level security;

drop policy if exists "brand_demo_accounts via brand" on public.brand_demo_accounts;
create policy "brand_demo_accounts via brand" on public.brand_demo_accounts for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Drop the vault secret when the row (or the brand) is deleted.
create or replace function public._cleanup_demo_account_secret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from vault.secrets
  where name = 'blog_integration_' || old.brand_id || '_demo_account';
  return old;
end;
$$;

drop trigger if exists trg_brand_demo_accounts_cleanup on public.brand_demo_accounts;
create trigger trg_brand_demo_accounts_cleanup
  before delete on public.brand_demo_accounts
  for each row execute function public._cleanup_demo_account_secret();
