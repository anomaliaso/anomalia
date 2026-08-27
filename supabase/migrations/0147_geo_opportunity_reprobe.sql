-- GEO opportunity multi-attempt reprobe + SFB listing draft storage.

alter table public.brand_geo_opportunities
  add column if not exists reprobe_attempts integer not null default 0;

comment on column public.brand_geo_opportunities.reprobe_attempts is
  'How many citation reprobes have run (max 3 → lost if still uncited).';

alter table public.brand_backlink_orders
  add column if not exists listing jsonb not null default '{}'::jsonb;

comment on column public.brand_backlink_orders.listing is
  'Owner-reviewed SubmitForBacklinks listing fields (draft → submit).';
