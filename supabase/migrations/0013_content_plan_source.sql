-- 0013 content_plans.source: tag where a plan came from so we can filter and
-- manage its lifecycle later (e.g. the recurring cron should only touch its own).
-- Values: 'onboarding' (legacy first plan), 'manual_trigger' (user clicked "Generate
-- next week"), 'scheduled_cron' (recurring planner, separate feature). Nullable so the
-- existing onboarding insert keeps working until it's backfilled.
alter table public.content_plans add column if not exists source text;
