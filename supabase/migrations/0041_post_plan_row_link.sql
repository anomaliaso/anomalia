-- 0041: pin every produced post to the exact editorial-plan ROW (seed) that generated it, and keep
-- that row's strategic ANGLE. `plan_id` (0004) already links the post to the batch (content_plan);
-- `plan_row_id` references the specific seed inside it (seeds live in content_plans.seeds jsonb, so
-- this is a plain uuid reference, not a FK). `pillar` (0038) and `format` (0018) already exist and
-- are now propagated at generation time too. The plan stays the single source of truth; the post is
-- a projection that conserves the link + the inherited metadata. Nullable so fresh/legacy posts and
-- the from-scratch "generate week" path (no source row) stay NULL — no backfill needed.
alter table public.posts add column if not exists plan_row_id uuid;
alter table public.posts add column if not exists angle text;
create index if not exists posts_plan_row_idx on public.posts (plan_row_id);
