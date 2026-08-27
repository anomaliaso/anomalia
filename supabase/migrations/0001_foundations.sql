-- 0001 foundations: identity, admin gate, brands root, waitlist + RLS
-- Applied to Supabase project kszazivzwievqixcnanp on 2026-06-02 via MCP.

create type member_role as enum ('owner','admin','manager','creator','viewer');
create type brand_status as enum ('trial','active','paused','canceled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  utm text,
  created_at timestamptz not null default now()
);

create table public.admins (
  email text primary key,
  granted_at timestamptz not null default now(),
  note text
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  name text not null,
  website text,
  status brand_status not null default 'trial',
  plan text,
  stripe_subscription_id text,
  trial_ends_at timestamptz,
  timezone text not null default 'Europe/Rome',
  zernio_profile_id text,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table public.waitlist (
  user_id uuid primary key references auth.users(id) on delete cascade,
  utm text,
  referred_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- helpers (security definer → bypass RLS for gate/queue checks)
create or replace function public.is_admin() returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email',''))
  );
$$;

create or replace function public.auth_brand_ids() returns setof uuid
  language sql security definer set search_path = public stable as $$
  select b.id from public.brands b
  join public.organizations o on o.id = b.org_id
  where o.owner_id = auth.uid();
$$;

create or replace function public.waitlist_position() returns integer
  language sql security definer set search_path = public stable as $$
  select 99 + (
    select count(*)::int from public.profiles p
    where p.created_at < (select created_at from public.profiles where id = auth.uid())
      and lower(coalesce(p.email,'')) not in (select lower(email) from public.admins)
  );
$$;

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.admins enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.brands enable row level security;
alter table public.waitlist enable row level security;

create policy "profiles self select" on public.profiles for select using (id = auth.uid());
create policy "profiles self update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admins self read" on public.admins for select
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
create policy "org owner all" on public.organizations for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "org_members self read" on public.org_members for select using (user_id = auth.uid());
create policy "org_members owner manage" on public.org_members for all
  using (org_id in (select id from public.organizations where owner_id = auth.uid()))
  with check (org_id in (select id from public.organizations where owner_id = auth.uid()));
create policy "brands via org" on public.brands for all
  using (org_id in (select id from public.organizations where owner_id = auth.uid()))
  with check (org_id in (select id from public.organizations where owner_id = auth.uid()));
create policy "waitlist self read" on public.waitlist for select using (user_id = auth.uid());
create policy "waitlist self insert" on public.waitlist for insert with check (user_id = auth.uid());

-- Il primo amministratore: NON e' seminato qui. Su un'installazione nuova, inseriscilo a mano
-- una volta sola, con l'email con cui farai login:
--   insert into public.admins (email, note) values ('tu@esempio.it', 'founder');
-- (Era cablato un indirizzo personale: su una repo pubblica sarebbe un dato personale spedito a
-- chiunque cloni, e su ogni installazione altrui un amministratore che il proprietario non ha
-- scelto. La riga NON viene cancellata dalle installazioni esistenti: chi ce l'ha, la tiene.)

-- ── 0001b: harden SECURITY DEFINER function grants ──
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.auth_brand_ids() from public;
revoke execute on function public.waitlist_position() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.auth_brand_ids() to authenticated;
grant execute on function public.waitlist_position() to authenticated;

-- ── 0001c: Supabase grants EXECUTE explicitly to anon; revoke it ──
revoke execute on function public.is_admin() from anon;
revoke execute on function public.auth_brand_ids() from anon;
revoke execute on function public.waitlist_position() from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;
