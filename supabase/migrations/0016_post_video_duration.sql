-- 0016 posts.video_duration_seconds: record the length of generated video clips so we can
-- reconcile real video spend. Seedance Lite is billed per second (~$0.205/s), so the clip's
-- duration is the unit we'd cost against. Nullable: only generated_video posts carry a value;
-- image/text posts (and all pre-existing rows) stay NULL. No backfill needed.
--
-- No RLS change: posts already has the "posts via brand" policy from 0004 and this column
-- lives on that same table. The monthly video guardrail (Starter 2 / Pro 5 / Scale 8) is
-- enforced in application code (content/generate/+server.ts via brand_usage.videos_count);
-- this column is for analytics / cost reporting, not the live cap.
alter table public.posts
  add column if not exists video_duration_seconds int default null;
