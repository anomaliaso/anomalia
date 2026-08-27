-- Cover/thumbnail image for a blog article: shown in the index list + as the article hero, and used
-- as the og:image / twitter:image for social sharing. Public URL (media bucket).
alter table public.brand_articles add column if not exists cover_image text;
