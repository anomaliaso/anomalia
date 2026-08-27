-- 0030 onboarding drafts + brand creator attribution
--
-- Two things:
--  1. brands.created_by / onboarding_completed_at — record WHICH user actually created a brand
--     (the org owns it, but an org can have several members), plus when onboarding finished.
--  2. onboarding_drafts — one resumable draft per user. Onboarding state used to live only in the
--     browser and was persisted solely at the final submit, so leaving mid-flow lost everything.
--     We now autosave the whole wizard state as JSON per step and rehydrate it on return.

alter table public.brands
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists onboarding_completed_at timestamptz;

create table if not exists public.onboarding_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  phase text,                                   -- wizard step to resume at
  draft jsonb not null default '{}'::jsonb,     -- full client state snapshot
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.onboarding_drafts enable row level security;

-- A user only ever touches their own draft (server uses the user-scoped client, so RLS applies).
create policy "onboarding_drafts self" on public.onboarding_drafts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
