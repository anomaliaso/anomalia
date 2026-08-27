-- 0040 onboarding generation jobs (move AI calc to the backend)
--
-- Onboarding's AI work (competitor discovery → deep research → strategy report → editorial plan →
-- first posts → image render) used to run client-driven in a streaming page: the user had to sit on
-- the wizard for the whole ~10 minutes. We now collect the inputs interactively, then hand off to a
-- BACKGROUND state machine that runs each stage server-side and emails a recap when it's done.
--
-- A single Vercel function can't hold ~10 minutes (300s cap), so the job is split into stages
-- (S1..S7), each well under the limit. /api/v1/onboarding/process advances ONE stage per invocation and
-- self-chains to the next (with a cron `*/2` backstop for stalled/failed jobs). This table is the
-- durable state: what to generate (input), how far we got (stage/progress), and the outcome.

create table if not exists public.onboarding_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  brand_id uuid references public.brands(id) on delete cascade,   -- the brand-shell created at hand-off
  status text not null default 'pending',      -- pending | processing | ready | failed
  stage text not null default 'S1',            -- S1..S7 | done — the next stage to run
  progress jsonb not null default '{}'::jsonb,  -- running counts for the UI + recap email (competitors, posts, images…)
  input jsonb not null default '{}'::jsonb,     -- collected wizard inputs + serialisable intermediate outputs threaded between stages
  locale text,                                  -- recipient locale for the recap email (en | it)
  error text,                                   -- last stage error (cleared on a successful advance)
  attempts int not null default 0,             -- consecutive failures on the CURRENT stage; 3 → status 'failed'
  stage_started_at timestamptz,                -- when the current stage began (cron uses this to detect stalls)
  recap_email_sent_at timestamptz,             -- set once, so the recap is never sent twice
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists onboarding_jobs_user_id_idx on public.onboarding_jobs (user_id);
-- The cron backstop scans by status to find advanceable jobs (pending / stalled processing / retryable failed).
create index if not exists onboarding_jobs_status_idx on public.onboarding_jobs (status);
create index if not exists onboarding_jobs_brand_id_idx on public.onboarding_jobs (brand_id);

alter table public.onboarding_jobs enable row level security;

-- The owner reads their own job (the "we're working on it" screen polls it via the user-scoped
-- client). All WRITES come from the server: the authenticated action creates the row, and the
-- background processor (service-role client) advances it — the service role bypasses RLS, so no
-- update/insert policy is needed for it.
create policy "onboarding_jobs select own" on public.onboarding_jobs
  for select using (user_id = auth.uid());

-- The authenticated wizard action inserts the job for the signed-in user.
create policy "onboarding_jobs insert own" on public.onboarding_jobs
  for insert with check (user_id = auth.uid());

-- Reflect background generation state on the brand so the /app list can badge a brand as still
-- being prepared (generating), ready to review (ready), or broken (failed). NULL = legacy/normal.
alter table public.brands
  add column if not exists onboarding_status text;  -- generating | ready | failed | null
