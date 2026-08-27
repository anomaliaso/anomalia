-- ============================================================================
-- Recurring autopilot cron — REFERENCE / DOCUMENTATION ONLY. DO NOT auto-apply.
-- ============================================================================
-- This sets up a daily pg_cron job that POSTs to the app's /api/v1/autopilot/tick
-- endpoint with the shared secret header. The tick endpoint then finds every brand
-- whose cadence is due (content_prefs.frequency vs last_autopilot_run_at) and runs it.
--
-- The job runs DAILY; per-brand cadence (daily / 5-per-week / 3-per-week) is enforced
-- inside the tick endpoint, not here — so one cron entry serves every brand.
--
-- Apply manually in the Supabase SQL editor (or via MCP) ONLY when you intend to turn
-- recurring autopilot on. Substitute the two placeholders first:
--   {{APP_URL}}          e.g. https://021.app   (no trailing slash)
--   {{AUTOPILOT_SECRET}} the same value set in the app's AUTOPILOT_SECRET env var
--
-- NOTE: if pg_cron / pg_net are unavailable on your plan, you do NOT need this file.
-- Any external scheduler works — point e.g. a Vercel Cron, GitHub Actions schedule, or
-- AWS EventBridge at:  POST {{APP_URL}}/api/v1/autopilot/tick
--   header  X-Autopilot-Secret: {{AUTOPILOT_SECRET}}
-- once per day. The endpoint is idempotent per cadence window (it only runs due brands and
-- skips brands with a run already in flight), so an occasional double-fire is harmless.
-- ============================================================================

-- (A) Enable the extensions. pg_cron schedules the job; pg_net makes the outbound HTTP call.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- pg_cron jobs run as the bootstrap superuser; grant usage so it can schedule.
grant usage on schema cron to postgres;

-- (B + C) Schedule the daily tick at 06:00 UTC. cron.schedule(job_name, cron_expr, sql).
-- The SQL body uses pg_net.http_post to fire-and-forget a POST at the tick endpoint with the
-- secret header. pg_net is async: it queues the request and returns a request id immediately,
-- so the cron tick itself stays instant regardless of how long generation takes.
select cron.schedule(
  'autopilot-daily-tick',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := '{{APP_URL}}/api/v1/autopilot/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Autopilot-Secret', '{{AUTOPILOT_SECRET}}'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- To inspect or remove the job later:
--   select * from cron.job;                       -- list jobs
--   select * from cron.job_run_details             -- recent run history
--     order by start_time desc limit 20;
--   select cron.unschedule('autopilot-daily-tick'); -- remove the job

-- ============================================================================
-- Weekly recap email — REFERENCE / DOCUMENTATION ONLY. DO NOT auto-apply.
-- ============================================================================
-- Sends every brand owner a performance recap every Monday at 08:00 UTC:
-- post activity, engagement metrics, trends, AI suggestions, and action items.
-- Same auth pattern as the autopilot tick (CRON_SECRET or AUTOPILOT_SECRET).
-- ============================================================================

select cron.schedule(
  'weekly-recap-tick',
  '0 8 * * 1',
  $$
  select net.http_post(
    url     := '{{APP_URL}}/api/v1/weekly-recap/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Autopilot-Secret', '{{AUTOPILOT_SECRET}}'
    ),
    body    := '{}'::jsonb
  );
  $$
);

--   select cron.unschedule('weekly-recap-tick');   -- remove the job
