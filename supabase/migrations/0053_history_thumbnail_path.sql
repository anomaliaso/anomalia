-- Durable media for the post history: scraped thumbnail_url values are signed platform-CDN links
-- that die within days; thumbnail_path points at OUR archived copy in the private brand-knowledge
-- bucket (path convention {ownerId}/{brandId}/history/…), written at materialize time while the
-- CDN link is still alive. Consumers prefer the signed archived copy and fall back to the URL.
alter table public.social_post_history add column if not exists thumbnail_path text;
