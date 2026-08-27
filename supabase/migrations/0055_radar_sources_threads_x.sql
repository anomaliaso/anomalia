-- New Radar source kinds: Threads keyword search (/v1/threads/search) and X Community tweets
-- (X has no keyword search — niche communities are the engage surface there).
alter table public.brand_news_sources drop constraint if exists brand_news_sources_kind_check;
alter table public.brand_news_sources add constraint brand_news_sources_kind_check
  check (kind in ('gnews_query', 'rss', 'subreddit', 'threads_query', 'x_community'));
