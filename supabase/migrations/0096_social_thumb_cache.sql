-- 0096 Social thumbnail cache: when the SocialThumbPicker scrapes an account's post thumbnails,
-- we archive them into OUR storage (brand-knowledge bucket) and remember the stored paths per
-- (platform, handle) for at least a day. This (a) fixes browser display — social CDNs send
-- Cross-Origin-Resource-Policy: same-origin, so their URLs can't render in our page, but our
-- signed storage URLs can; and (b) avoids re-scraping + re-downloading the same account daily.
-- Global (brand-agnostic): a handle's thumbnails are identical for every brand.
create table if not exists public.social_thumb_cache (
  platform text not null,
  handle text not null,
  paths text[] not null default '{}',
  fetched_at timestamptz not null default now(),
  primary key (platform, handle)
);

-- Accessed only server-side via the admin (service-role) client. Enable RLS with NO policies so
-- the anon/auth keys can never read or write it; the service role bypasses RLS.
alter table public.social_thumb_cache enable row level security;
