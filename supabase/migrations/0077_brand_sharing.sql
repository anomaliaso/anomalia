-- 0077 brand sharing: per-brand members + email invites.
-- A member gets full access to ONE brand's data (not the whole org) by widening
-- auth_brand_ids(), the single choke point every brand-scoped RLS policy calls.
-- No roles: a member is a member. Billing/ownership stays with the org owner
-- (brands writes still go through "brands via org" only).

create table public.brand_members (
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);

create table public.brand_invites (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  email text not null, -- stored lowercased
  -- Snapshots so the invitee can render the invite before having any access to brands/profiles.
  brand_name text not null,
  inviter_email text,
  token uuid not null default gen_random_uuid(),
  invited_by uuid not null references auth.users(id) on delete cascade,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (brand_id, email)
);

alter table public.brand_members enable row level security;
alter table public.brand_invites enable row level security;

-- Brands shared with me. SECURITY DEFINER so policies can use it without
-- brands <-> brand_members policy recursion.
create or replace function public.member_brand_ids() returns setof uuid
  language sql security definer set search_path = public stable as $$
  select brand_id from public.brand_members where user_id = auth.uid();
$$;

-- Widen the choke point: brands I own (via org) ∪ brands shared with me.
create or replace function public.auth_brand_ids() returns setof uuid
  language sql security definer set search_path = public stable as $$
  select b.id from public.brands b
  join public.organizations o on o.id = b.org_id
  where o.owner_id = auth.uid()
  union
  select brand_id from public.brand_members where user_id = auth.uid();
$$;

-- Members can read the brand row itself; writes stay owner-only ("brands via org").
create policy "brands member select" on public.brands for select
  using (id in (select public.member_brand_ids()));

create policy "brand_members self read" on public.brand_members for select
  using (user_id = auth.uid());
create policy "brand_members owner manage" on public.brand_members for all
  using (brand_id in (select b.id from public.brands b join public.organizations o on o.id = b.org_id where o.owner_id = auth.uid()))
  with check (brand_id in (select b.id from public.brands b join public.organizations o on o.id = b.org_id where o.owner_id = auth.uid()));

create policy "brand_invites owner manage" on public.brand_invites for all
  using (brand_id in (select b.id from public.brands b join public.organizations o on o.id = b.org_id where o.owner_id = auth.uid()))
  with check (brand_id in (select b.id from public.brands b join public.organizations o on o.id = b.org_id where o.owner_id = auth.uid()));
create policy "brand_invites invitee read" on public.brand_invites for select
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));

-- Accept an invite: DEFINER because the invitee can't insert into brand_members
-- themselves. The token is the capability; the email must match the caller's JWT
-- so an intercepted link can't be redeemed by another account. Single-use, 7 days.
-- Returns the brand slug for the post-accept redirect, null if invalid/expired.
create or replace function public.accept_brand_invite(p_token uuid) returns text
  language plpgsql security definer set search_path = public as $$
declare
  v_invite public.brand_invites%rowtype;
  v_slug text;
begin
  if auth.uid() is null then return null; end if;
  select * into v_invite from public.brand_invites
    where token = p_token
      and accepted_at is null
      and created_at > now() - interval '7 days'
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email',''));
  if not found then return null; end if;
  insert into public.brand_members (brand_id, user_id)
    values (v_invite.brand_id, auth.uid())
    on conflict do nothing;
  update public.brand_invites set accepted_at = now(), accepted_by = auth.uid()
    where id = v_invite.id;
  select slug into v_slug from public.brands where id = v_invite.brand_id;
  return v_slug;
end; $$;

-- Same grant hardening as 0001.
revoke execute on function public.member_brand_ids() from public, anon;
grant execute on function public.member_brand_ids() to authenticated;
revoke execute on function public.accept_brand_invite(uuid) from public, anon;
grant execute on function public.accept_brand_invite(uuid) to authenticated;
