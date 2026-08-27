-- 0157 rotation cursor for /api/v1/analytics/visual/tick. Same pattern as 0149/0150: the tick
-- denormalizes its last-run timestamp on brands and orders by it, so the 10-brand cap rotates
-- across the fleet instead of processing the same first ten slugs forever.

alter table public.brands
  add column if not exists last_visual_at timestamptz;

create index if not exists brands_last_visual_idx on public.brands (last_visual_at) where status = 'active';
