-- 0149: idempotent "strategy + editorial plan ready" email flag on step jobs.
--
-- Research (kind=research) runs as a durable background job so users can leave the tab.
-- When it finishes we email them once; this column prevents duplicate sends on worker retries.

alter table public.onboarding_step_jobs
  add column if not exists notify_email_sent_at timestamptz;
