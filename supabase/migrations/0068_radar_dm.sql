-- Radar lead-gen: alongside the comment suggestion, draft a 1:1 DM to the post AUTHOR (popsy-style).
-- Draft-only — the human sends it. dm_target is the author's handle (for "open profile / send DM").
alter table public.brand_news_items add column if not exists dm_draft text;
alter table public.brand_news_items add column if not exists dm_target text;
