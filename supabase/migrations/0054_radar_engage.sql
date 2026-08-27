-- Radar engage: the AI-drafted Reddit comment suggestion rides on the scanned item
-- (status 'suggested'); the user copies it and comments MANUALLY — 021 never touches Reddit.
alter table public.brand_news_items add column if not exists suggestion text;
