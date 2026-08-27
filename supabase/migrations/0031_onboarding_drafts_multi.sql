-- 0031 onboarding drafts: allow MULTIPLE drafts per user
--
-- 0030 made onboarding_drafts one row per user (PK user_id), and onboarding auto-resumed it. We now
-- want each "new brand" onboarding to be its own resumable draft, listed in /app as a "Continue"
-- section — so a user can have several in flight at once and "new brand" always starts blank.
-- Switch the primary key to a synthetic id and keep user_id as a plain (indexed) FK. Existing rows
-- are preserved, each backfilled with a fresh id (gen_random_uuid is volatile → evaluated per row).

alter table public.onboarding_drafts
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.onboarding_drafts drop constraint if exists onboarding_drafts_pkey;
alter table public.onboarding_drafts add constraint onboarding_drafts_pkey primary key (id);

create index if not exists onboarding_drafts_user_id_idx on public.onboarding_drafts (user_id);

-- RLS policy from 0030 still applies unchanged (user_id = auth.uid()).
