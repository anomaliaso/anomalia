-- New Radar source kind: global Reddit keyword search (/v1/reddit/search) — same pattern as
-- threads_query/x_community but across ALL of Reddit, not a single subreddit.
alter table public.brand_news_sources drop constraint if exists brand_news_sources_kind_check;
alter table public.brand_news_sources add constraint brand_news_sources_kind_check
  check (kind in ('gnews_query', 'rss', 'subreddit', 'threads_query', 'x_community', 'reddit_query'));
