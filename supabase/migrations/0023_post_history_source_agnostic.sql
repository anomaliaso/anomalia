-- 0023: make social_post_history source-agnostic so it can hold posts scraped via
-- scrapecreators (full organic history) and not only Zernio analytics. Existing rows are
-- tagged source='zernio'; new scrapecreators syncs use source='scrapecreators'.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-04 via MCP.
alter table public.social_post_history
  add column if not exists source text not null default 'zernio';

alter table public.social_post_history
  rename column zernio_external_post_id to external_post_id;

alter table public.social_post_history
  drop constraint social_post_history_brand_id_zernio_external_post_id_key;

alter table public.social_post_history
  add constraint social_post_history_brand_source_extid_key unique (brand_id, source, external_post_id);
