-- Real Google organic-search metrics (DataForSEO) attached to each GEO snapshot: organic keyword
-- count, estimated traffic, top-10 count, and the top ranking keywords table. See SearchPerformance.
alter table public.brand_geo_audits add column if not exists search jsonb;
