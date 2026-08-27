-- 0133: onboarding competitor discovery as a durable background job.
--
-- WHY: discovery used to run inside a streamed POST. Leaving the tab (or Mobile Safari dropping
-- the NDJSON connection) killed the work mid-flight and the user saw "Could not research
-- competitors" even when the server had already finished. A short-lived job row + page poll means
-- the fetch survives navigation; the user comes back to a ready result.
--
-- brand_id is intentionally NOT a FK to brands: during early wizard the client mints a UUID that
-- only becomes brands.id at create/finish. draft_id ties the job to the autosaved wizard blob so
-- a done result can be mirrored there for resume.

create table if not exists public.onboarding_competitor_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid references public.onboarding_drafts(id) on delete set null,
  brand_id uuid,                                 -- client-minted; may not exist in brands yet
  status text not null default 'pending',        -- pending | running | done | failed
  progress jsonb not null default '{}'::jsonb,   -- { step, message } for the UI while polling
  input jsonb not null default '{}'::jsonb,      -- profile / platforms / handles snapshot
  result jsonb,                                  -- { competitors, citations } when done
  error text,
  attempts int not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists onboarding_competitor_jobs_status_idx
  on public.onboarding_competitor_jobs (status);
create index if not exists onboarding_competitor_jobs_user_idx
  on public.onboarding_competitor_jobs (user_id, created_at desc);
create index if not exists onboarding_competitor_jobs_brand_idx
  on public.onboarding_competitor_jobs (brand_id, created_at desc)
  where brand_id is not null;

alter table public.onboarding_competitor_jobs enable row level security;

-- Owner polls their own job from the wizard. Enqueue is authenticated-user insert; all other
-- writes (status/progress/result) come from the service-role worker.
create policy "onboarding_competitor_jobs select own" on public.onboarding_competitor_jobs
  for select using (user_id = auth.uid());

create policy "onboarding_competitor_jobs insert own" on public.onboarding_competitor_jobs
  for insert with check (user_id = auth.uid());

-- Supersede (force re-run) marks the owner's in-flight rows failed from the authenticated route.
create policy "onboarding_competitor_jobs update own" on public.onboarding_competitor_jobs
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
