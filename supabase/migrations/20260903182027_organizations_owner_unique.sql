-- ensureOrgForUser() (src/lib/server/org.ts) is check-then-insert with no DB-level
-- uniqueness on owner_id: two concurrent first-brand-creation requests for the same
-- new user can each pass the check and insert their own org. This constraint makes
-- the second insert fail instead, so the code can fall back to the winner's row.
drop index if exists public.organizations_owner_id_idx;

alter table public.organizations
  add constraint organizations_owner_id_key unique (owner_id);
