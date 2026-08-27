-- 0134: generalize onboarding_competitor_jobs → onboarding_step_jobs.
--
-- Competitor discovery was the first step moved off the NDJSON stream onto a durable job + poll.
-- Strategy research, post planning and image render have the same Mobile Safari / tab-leave
-- failure mode, so the table becomes kind-scoped: competitors | research | plan_posts | preview_images.

alter table public.onboarding_competitor_jobs rename to onboarding_step_jobs;

alter table public.onboarding_step_jobs
  add column if not exists kind text not null default 'competitors';

-- Existing rows are competitor discovery jobs (the only kind that existed before this migration).
update public.onboarding_step_jobs set kind = 'competitors' where kind is null or kind = '';

alter table public.onboarding_step_jobs
  drop constraint if exists onboarding_step_jobs_kind_check;
alter table public.onboarding_step_jobs
  add constraint onboarding_step_jobs_kind_check
  check (kind in ('competitors', 'research', 'plan_posts', 'preview_images'));

-- Rename indexes (drop old names created in 0133, recreate with kind awareness).
drop index if exists onboarding_competitor_jobs_status_idx;
drop index if exists onboarding_competitor_jobs_user_idx;
drop index if exists onboarding_competitor_jobs_brand_idx;

create index if not exists onboarding_step_jobs_status_idx
  on public.onboarding_step_jobs (status);
create index if not exists onboarding_step_jobs_kind_status_idx
  on public.onboarding_step_jobs (kind, status);
create index if not exists onboarding_step_jobs_user_idx
  on public.onboarding_step_jobs (user_id, kind, created_at desc);
create index if not exists onboarding_step_jobs_brand_idx
  on public.onboarding_step_jobs (brand_id, kind, created_at desc)
  where brand_id is not null;

-- Rename RLS policies to match the new table name.
drop policy if exists "onboarding_competitor_jobs select own" on public.onboarding_step_jobs;
drop policy if exists "onboarding_competitor_jobs insert own" on public.onboarding_step_jobs;
drop policy if exists "onboarding_competitor_jobs update own" on public.onboarding_step_jobs;

create policy "onboarding_step_jobs select own" on public.onboarding_step_jobs
  for select using (user_id = auth.uid());
create policy "onboarding_step_jobs insert own" on public.onboarding_step_jobs
  for insert with check (user_id = auth.uid());
create policy "onboarding_step_jobs update own" on public.onboarding_step_jobs
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
