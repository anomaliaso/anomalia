-- 0200: why a post has no permanent copy of its media.
--
-- `media_path` null has meant three different things since 0183 and looked identical in all three:
-- never tried, tried and the CDN link had already rotted, tried and the file was 300MB. The sweep
-- that stores a post archives at most 30 media per tick and only from the rows IT fetched, so
-- everything past that cap was stranded — no queue could pick it up, because no column said whether
-- picking it up was worth a request.
--
-- Two columns close it. `media_attempted_at` turns "no copy" into a queue with a memory, and
-- `media_error` says which of the three it was, so a dead link stops costing a download a day while
-- a transient failure can still be retried on purpose.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

alter table public.market_posts
  add column if not exists media_attempted_at timestamptz,
  add column if not exists media_error text;

-- The archive queue: something to fetch, nothing fetched yet, never attempted.
create index if not exists market_posts_media_queue_idx
  on public.market_posts (discovered_at desc)
  where media_url is not null and media_path is null and media_attempted_at is null;
