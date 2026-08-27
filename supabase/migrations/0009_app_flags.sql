-- 0009: DB-backed feature flags (toggle without redeploy).
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-03 via MCP.
create table if not exists public.app_flags (
  key text primary key, enabled boolean not null default false, value text,
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;
create or replace function public.flag_enabled(p_key text, p_default boolean default false)
  returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select enabled from public.app_flags where key = p_key), p_default); $$;
create or replace function public.can_enter()
  returns boolean language sql security definer set search_path = public stable as $$
  select (not public.flag_enabled('waitlist', true)) or public.is_admin(); $$;
revoke execute on function public.flag_enabled(text, boolean) from public, anon;
revoke execute on function public.can_enter() from public, anon;
grant execute on function public.flag_enabled(text, boolean) to authenticated;
grant execute on function public.can_enter() to authenticated;
insert into public.app_flags (key, enabled) values ('waitlist', false) on conflict (key) do nothing;
