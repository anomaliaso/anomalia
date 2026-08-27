-- One-time (or time-bound) extra AI credit grants. Folded into getCreditsUsage() as a
-- quota boost — not a stored balance. Service role writes; brand members may read.

create table if not exists public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  amount integer not null check (amount > 0),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- null = never expires (permanent boost until the row is deleted)
  expires_at timestamptz
);

create index if not exists credit_grants_brand_idx
  on public.credit_grants (brand_id);

alter table public.credit_grants enable row level security;

drop policy if exists "credit_grants readable by brand members" on public.credit_grants;
create policy "credit_grants readable by brand members" on public.credit_grants
  for select using (brand_id in (select public.auth_brand_ids()));
-- Writes: service role only (no insert/update/delete policies for authenticated).
