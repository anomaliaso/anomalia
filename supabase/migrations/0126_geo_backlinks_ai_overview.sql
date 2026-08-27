-- 0126 two new panels on the weekly GEO/SEO snapshot, both from DataForSEO endpoints the free
-- tools opened up:
--   backlinks   — referring domains, authority rank, spam score, follow split (Backlinks API)
--   ai_overview — for the brand's top ranked keywords, whether Google shows an AI Overview and
--                 whether the brand is among the domains it cites (SERP API)
-- The AI Overview column is the one that matters strategically: it is the difference between
-- "we rank" and "we are in the answer", and nothing else in the app measured it.
alter table public.brand_geo_audits
  add column if not exists backlinks jsonb,
  add column if not exists ai_overview jsonb;
