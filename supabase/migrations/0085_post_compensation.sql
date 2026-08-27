-- Phase 3: Flag for compensatory posts generated after an incident.
-- These posts bypass quota counting and are left in pending_user for owner review.

alter table public.posts add column is_compensation boolean default false;
