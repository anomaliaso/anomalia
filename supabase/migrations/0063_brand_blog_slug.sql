-- A globally-unique public slug for the hosted blog's default URL (app-domain/blog/<blog_slug>).
-- brands.slug is unique across orgs too in production (see 0223), but the public router still
-- needs its own key: blog_slug can be renamed independently of the brand slug.
-- Provisioned lazily from the brand slug, with a numeric suffix only on collision.
alter table public.brands add column if not exists blog_slug text;
create unique index if not exists brands_blog_slug_key on public.brands (blog_slug) where blog_slug is not null;
