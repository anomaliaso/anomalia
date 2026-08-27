-- GEO artifacts can carry MULTIPLE copyable blocks that go to DIFFERENT places (e.g. a FAQ = the
-- page text AND a JSON-LD block for the <head>). Each block is { labelKey, content }; the UI renders
-- one textarea per block with its own copy button. `body` stays as a plain-text fallback/concat.
alter table public.brand_geo_artifacts add column if not exists blocks jsonb;
