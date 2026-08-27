-- 0154 brand_visual_insights: weekly visual↔engagement correlation buckets (P2 learning loop).
-- Written by /api/v1/analytics/visual/tick (upsert on the unique key), read by the produce
-- agent's WINNING VISUALS block. window_start is the Monday of the run week (stable, errata P2#3)
-- so consecutive runs overwrite the same rows instead of accumulating.

create table if not exists public.brand_visual_insights (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  window_start date not null,
  dimension text not null,   -- 'genre' | 'platform' | 'asset_source' | 'hook_type'
  value text not null,
  n integer not null,
  er_avg numeric,
  delta numeric,
  created_at timestamptz not null default now(),
  unique (brand_id, window_start, dimension, value)
);

create index if not exists brand_visual_insights_brand_win_idx
  on public.brand_visual_insights (brand_id, window_start desc);

alter table public.brand_visual_insights enable row level security;

create policy "brand_visual_insights via brand" on public.brand_visual_insights
  for all using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
