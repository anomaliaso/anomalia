-- Add meta_title and meta_description to article versions so AI revisions can update SEO fields.
alter table public.brand_article_versions add column if not exists meta_title text;
alter table public.brand_article_versions add column if not exists meta_description text;
