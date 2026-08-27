-- 0189: the catalogue is decided by the model, not inherited from the query.
--
-- Until now a market post's `category` was whatever we happened to search for: the hashtag, the
-- subreddit, the vertical whose keyword surfaced it. That is a label about US — about which query
-- ran — not about the content. Two problems follow. The trending feeds carry no query at all, so
-- every video that arrived through `trending:IT` was simply uncategorised. And a "food" keyword
-- routinely returns a gym owner talking about meal prep, which then pollutes the food bucket that
-- `correlateByCategory` groups on.
--
-- So the catalogue moves to Gemini, which has already watched the clip and read the caption. Three
-- fields, deliberately different in kind:
--
--   category      one of a FIXED vertical list — fixed because the whole point is grouping, and a
--                 free-form label cannot be grouped
--   content_form  one of a FIXED structural list — the shape of the piece (talking head, tutorial,
--                 before/after…). This is the axis that actually answers "what kind of video
--                 works", which a vertical never can
--   topic         free text, specific. Not for grouping — for reading, and for the retrieval brief
--                 that will look for "posts about X in this vertical"
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

alter table public.market_posts
  add column if not exists topic text,
  add column if not exists content_form text,
  -- 'query' = inherited from the search that found it (the old behaviour, kept so existing rows
  -- stay readable); 'gemini' = the model decided. The categoriser only ever overwrites the former,
  -- so a re-run is cheap and never re-bills a row it already judged.
  add column if not exists category_source text,
  add column if not exists categorised_at timestamptz;

-- Backfill the provenance of what is already there: every existing category came from the query.
update public.market_posts
   set category_source = 'query'
 where category is not null
   and category_source is null;

-- The categoriser's work queue: rows the model has not judged yet, newest first.
create index if not exists market_posts_uncategorised_idx
  on public.market_posts (discovered_at desc)
  where category_source is distinct from 'gemini';

-- The grouping the fit reads.
create index if not exists market_posts_catalogue_idx
  on public.market_posts (category, content_form)
  where category_source = 'gemini';
