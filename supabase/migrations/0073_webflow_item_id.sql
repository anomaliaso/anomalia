-- Track the Webflow CMS item id per source article so re-publishing updates the same item
-- (avoids slug conflicts) instead of creating a duplicate. Mirrors shopify_article_id.
-- Webflow reuses the platform-agnostic blog_integrations row (platform='webflow', access_token=API
-- token, store=siteId, blog_id=collectionId) — no new credential columns needed.
alter table public.brand_articles add column if not exists webflow_item_id text;
