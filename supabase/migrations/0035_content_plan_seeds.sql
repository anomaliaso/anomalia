-- 0035: row-level editorial planning. A weekly batch can now exist as a DRAFT of planned rows
-- (the strategist's pass-1 seeds: when/platform/format/angle/subject) that the user edits,
-- reorders and approves BEFORE any caption or image is produced — "nothing is produced until
-- you confirm" extended from the single post to the whole week. The seeds live on the batch
-- container itself; content_plans.status gains the value 'draft' (plain text column, no check):
--   'draft' (rows under review, no posts yet) → 'proposed' (posts produced, pending approval) → …
alter table public.content_plans add column if not exists seeds jsonb;
