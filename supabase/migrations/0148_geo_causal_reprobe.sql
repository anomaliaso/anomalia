-- Causal GEO reprobe: baseline engines + per-attempt evidence log.

alter table public.brand_geo_opportunities
  add column if not exists baseline_engines text[] not null default '{}'::text[];

alter table public.brand_geo_opportunities
  add column if not exists reprobe_log jsonb not null default '[]'::jsonb;

comment on column public.brand_geo_opportunities.baseline_engines is
  'Engines where the brand was absent when the opportunity opened.';

comment on column public.brand_geo_opportunities.reprobe_log is
  'Append-only array of { at, attempt, engine, mentioned, sources, error, targetCited }.';
