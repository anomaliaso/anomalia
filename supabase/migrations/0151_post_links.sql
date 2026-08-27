-- 0151 post links: short-code click path for post CTAs (post → measurable traffic).
--
-- A produced post's link_url gets UTM tags appended at persist time (enrichCtaWithUtm in
-- content-preview.ts) and this table stores the short code + target so clicks are countable.
-- Two counters, deliberately distinct:
--   clicks_redirect — hits on the PUBLIC /l/[code] redirect (302). NOISY: platform crawlers
--     prefetch caption links for unfurl previews, so this over-counts real humans.
--   clicks_landing  — hits on the anonymous beacon fired from the target page itself
--     (POST /api/v1/links/hit). Clean signature: only real page loads report it.
-- The weekly recap's "Link clicks" stat sums both.

create table if not exists public.post_links (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  code text not null unique,          -- short code, randomBytes(6) → 48 bit
  target_url text not null,
  utm_source text not null default 'social',
  utm_medium text not null default 'post',
  utm_campaign text,
  utm_content text,
  label text,
  clicks_redirect integer not null default 0,
  clicks_landing integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists post_links_brand_idx on public.post_links (brand_id);

-- Link rows follow the same brand gate as the rest of the app (auth_brand_ids covers owned +
-- shared brands), so the web client can read/write its own brand's links.
alter table public.post_links enable row level security;
create policy "post_links_select_via_brand" on public.post_links
  for select using (brand_id in (select public.auth_brand_ids()));
create policy "post_links_insert_via_brand" on public.post_links
  for insert with check (brand_id in (select public.auth_brand_ids()));
create policy "post_links_update_via_brand" on public.post_links
  for update using (brand_id in (select public.auth_brand_ids())) with check (brand_id in (select public.auth_brand_ids()));
create policy "post_links_delete_via_brand" on public.post_links
  for delete using (brand_id in (select public.auth_brand_ids()));

-- Atomically bump one counter for a short code. Service-role only, mirroring bump_article_view
-- (0072_article_views.sql): the public /l/[code] redirect and the anonymous landing beacon have
-- no user session, so they run through the admin client while anon/authenticated are revoked.
-- 'code' shadows the column — the qualified name on the left resolves the row, the bare name
-- on the right resolves the parameter.
create or replace function public.bump_link_click(code text, kind text)
returns void
language sql
security definer
set search_path = public
as $$
  update post_links
  set clicks_redirect = case when kind = 'redirect' then clicks_redirect + 1 else clicks_redirect end,
      clicks_landing  = case when kind = 'landing'  then clicks_landing  + 1 else clicks_landing  end
  where post_links.code = code
$$;

revoke execute on function public.bump_link_click(text, text) from public, anon, authenticated;

-- bio_url: the brand's "link in bio" destination, kept on the connected account row so the
-- future bio-copy flow (suggestBioUrl in post-links.ts → write bio_url on the account) can
-- surface the best short link without touching social-publishing logic. No UI ships here.
alter table public.social_accounts add column if not exists bio_url text;
