-- 0161 daily digest idempotency cursor (review wave: double-fired cron would email the fleet twice)
alter table public.brands
  add column if not exists last_digest_sent_at timestamptz;
