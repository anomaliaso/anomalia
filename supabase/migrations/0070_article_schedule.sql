-- Scheduled publishing for blog articles: an optional future instant at which a draft flips to
-- 'published' (a cron does the flip). Lets the calendar show WHEN each blog post goes live.
alter table public.brand_articles add column if not exists scheduled_for timestamptz;
create index if not exists brand_articles_brand_scheduled_idx on public.brand_articles (brand_id, scheduled_for);
