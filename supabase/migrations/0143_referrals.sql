-- Growth referrals: share a link, both sides get AI credit grants when the
-- referee creates their first brand. Writes are service-role only; owners can
-- read their own code + referral history.

create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  -- Preferred brand that receives the referrer's credit grant.
  brand_id uuid references public.brands(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint referral_codes_code_format check (code ~ '^[a-z0-9]{6,12}$')
);

create index if not exists referral_codes_code_idx on public.referral_codes (code);
create index if not exists referral_codes_brand_idx on public.referral_codes (brand_id);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referee_user_id uuid not null unique references auth.users(id) on delete cascade,
  code text not null,
  referrer_brand_id uuid references public.brands(id) on delete set null,
  referee_brand_id uuid references public.brands(id) on delete set null,
  status text not null default 'credited'
    check (status in ('credited', 'rejected')),
  credits_each integer not null check (credits_each > 0),
  created_at timestamptz not null default now(),
  credited_at timestamptz
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id);
create index if not exists referrals_code_idx on public.referrals (code);

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;

drop policy if exists "referral_codes own read" on public.referral_codes;
create policy "referral_codes own read" on public.referral_codes
  for select using (user_id = auth.uid());

drop policy if exists "referrals party read" on public.referrals;
create policy "referrals party read" on public.referrals
  for select using (
    referrer_user_id = auth.uid() or referee_user_id = auth.uid()
  );
-- Inserts/updates: service role only (no authenticated write policies).
