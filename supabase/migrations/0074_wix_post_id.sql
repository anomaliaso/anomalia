-- Track the Wix blog draft-post id per source article so re-publishing updates the same post
-- instead of creating a duplicate. Mirrors shopify_article_id / webflow_item_id.
-- Wix reuses the platform-agnostic blog_integrations row (platform='wix', access_token=API key,
-- store=siteId) — no new credential columns needed.
alter table public.brand_articles add column if not exists wix_post_id text;
