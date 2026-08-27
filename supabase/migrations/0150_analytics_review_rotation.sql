-- 0150 analytics-review rotation (follow-up to 0149)
-- The analytics review tick needs a rotation cursor like the other ticks: a static
-- ORDER BY slug + LIMIT 3 revisits the same first slugs forever (freshness skips them)
-- and never reaches the rest. Denormalized cursor on brands, same pattern as the others.
alter table public.brands
  add column if not exists last_review_at timestamptz;

create index if not exists brands_last_review_idx on public.brands (last_review_at) where status = 'active';
