-- 0012 post-checkout setup flow: mark when a brand finished the guided
-- congrats → connect accounts → schedule-posts flow (so we don't re-run it).
alter table public.brands add column if not exists launched_at timestamptz;
