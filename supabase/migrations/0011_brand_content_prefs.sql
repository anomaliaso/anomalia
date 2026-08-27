-- 0011 onboarding style preferences (mood / tone / frequency / goal)
-- Kept on the brand so the recurring planner reuses the same voice & cadence.
alter table public.brands add column if not exists content_prefs jsonb;
