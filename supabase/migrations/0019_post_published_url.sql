-- 0019 posts.published_url: the live URL of the post once Zernio actually publishes it, so
-- the UI can flip 'scheduled' → 'published' and link straight to the real post.
alter table public.posts add column if not exists published_url text;
