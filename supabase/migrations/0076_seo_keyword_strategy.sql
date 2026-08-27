-- Per-brand SEO keyword attack strategy: which keywords to attack and where the best growth
-- margins vs competitors are. Regenerated when stale; feeds blog article generation.
create table if not exists public.brand_seo_keyword_strategy (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade unique,
  strategy jsonb not null,
  citations jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.brand_seo_keyword_strategy enable row level security;
