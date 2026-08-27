-- 0008: publishing audit. Posts go to Zernio (scheduled) on approval.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-03 via MCP.
alter table public.posts add column if not exists external_post_id text;
create table if not exists public.publish_logs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  social_account_id uuid references public.social_accounts(id) on delete set null,
  platform text, external_post_id text, status text not null, error text,
  created_at timestamptz not null default now()
);
create index if not exists publish_logs_brand_idx on public.publish_logs (brand_id);
alter table public.publish_logs enable row level security;
drop policy if exists "publish_logs via brand" on public.publish_logs;
create policy "publish_logs via brand" on public.publish_logs for all
  using (brand_id in (select public.auth_brand_ids())) with check (brand_id in (select public.auth_brand_ids()));
