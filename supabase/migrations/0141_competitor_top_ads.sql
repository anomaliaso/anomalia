-- Snapshot of Meta Ad Library ads per competitor (ScrapeCreators), plus a brand-level
-- "trending in category" ads list on market references. Mirrors competitors.top_posts pattern.
alter table public.competitors add column if not exists top_ads jsonb;

alter table public.brand_market_references add column if not exists ads jsonb not null default '[]'::jsonb;
