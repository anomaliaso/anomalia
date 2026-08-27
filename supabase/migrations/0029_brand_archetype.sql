-- 0029: brand archetype + polymorphic offerings.
-- Generalises the analysis beyond ecommerce. site_type classifies the site (ecommerce | saas |
-- portfolio | local_service | creator | generic); content_pillars holds the archetype's editorial
-- pillars for the planner. products gains `kind` so the same table holds products/services/
-- projects/features (products.url already exists from 0002). All additive + nullable/defaulted —
-- existing ecommerce rows keep working (kind defaults to 'product').
alter table public.brand_kit add column if not exists site_type text;
alter table public.brand_kit add column if not exists content_pillars jsonb;

alter table public.products add column if not exists kind text not null default 'product';
