-- 0149 tick rotation, published_at, brand_media RLS (from errata wave-2 review 09/08/2026)

-- 1. posts.published_at — queried by scheduler.ts (GTM review) but never existed; the query
--    failed silently. The column is written by publish.ts when a post actually publishes.
alter table public.posts
  add column if not exists published_at timestamptz;

-- 2. Rotation columns for cron ticks (rank / crawl). PostgREST cannot ORDER BY a nested
--    resource, so each tick denormalizes its last-run timestamp here and orders by it —
--    every brand is eventually visited, instead of the same first-N forever.
alter table public.brands
  add column if not exists last_rank_check_at timestamptz,
  add column if not exists last_crawl_at timestamptz;

create index if not exists brands_last_rank_check_idx on public.brands (last_rank_check_at) where status = 'active';
create index if not exists brands_last_crawl_idx on public.brands (last_crawl_at) where status = 'active';

-- 3. brand_tracked_keywords.last_checked_at — denormalized last SERP snapshot time so the
--    rank tick can ORDER BY it (round-robin) at the keyword level too.
alter table public.brand_tracked_keywords
  add column if not exists last_checked_at timestamptz;

create index if not exists brand_tracked_keywords_checked_idx
  on public.brand_tracked_keywords (brand_id, last_checked_at) where active;

-- 4. brand_media had RLS enabled with ZERO policies (deny-all for the web client) — the
--    media import flow cannot insert catalog rows. Same "via brand" policy as the other tables.
create policy "brand_media_select_via_brand" on public.brand_media
  for select using (brand_id in (select auth_brand_ids()));

create policy "brand_media_insert_via_brand" on public.brand_media
  for insert with check (brand_id in (select auth_brand_ids()));

create policy "brand_media_update_via_brand" on public.brand_media
  for update using (brand_id in (select auth_brand_ids())) with check (brand_id in (select auth_brand_ids()));

create policy "brand_media_delete_via_brand" on public.brand_media
  for delete using (brand_id in (select auth_brand_ids()));
