-- Allow brand members to read their keyword attack strategy (UI under Web → Keywords).
-- Writes stay service-role only (ensureKeywordStrategy / cron tick).
create policy "keyword strategy via brand" on public.brand_seo_keyword_strategy for select
  using (brand_id in (select public.auth_brand_ids()));
