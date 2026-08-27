-- Receive opportunities are one-per-partner-brand; two partners can both score the same
-- owned article, so uniqueness must include partner_brand_id (not only partner_article_id).
drop index if exists public.brand_backlink_opportunities_open_unique;

create unique index if not exists brand_backlink_opportunities_open_unique
  on public.brand_backlink_opportunities (brand_id, direction, partner_brand_id, partner_article_id)
  where status = 'open' and partner_article_id is not null;
