-- 0026: competitor research + brand strategy for the onboarding deep-research pipeline.
-- Adds the competitor set the user confirms, the synthesised strategy report, and the
-- complementary copy fields the planner now produces. Competitor *posts* are NOT stored in a
-- new table: they reuse the existing global scrapecreators_cache (keyed by platform+handle).

-- Brand-scoped: the competitors confirmed/edited by the user + a snapshot of their analysis.
create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  website text,
  kind text not null default 'direct' check (kind in ('direct', 'indirect')),
  rationale text,
  handles jsonb,        -- ScrapeTarget[] resolved for this competitor
  top_posts jsonb,      -- snapshot of top-engagement posts (caption, thumbnail, metrics)
  benchmark jsonb,      -- per-competitor quantitative stats (Stage D)
  source text not null default 'ai' check (source in ('ai', 'user')),
  created_at timestamptz not null default now()
);
create index competitors_brand_idx on public.competitors (brand_id);
alter table public.competitors enable row level security;
create policy "competitors via brand" on public.competitors for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Brand-scoped: one living strategy report per brand (onboarding writes once; rebuildable later).
create table public.brand_strategy (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  report jsonb,         -- Stage F: summary, whiteSpace[], differentiators[], threats[],
                        --          recommendedAngles[], platformGuidance[]
  benchmark jsonb,      -- Stage D: market-level benchmark
  positioning text,     -- Stage E: qualitative prose
  citations jsonb,      -- grounding sources [{uri, title}] for the "researched N sources" UI
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id)
);
create index brand_strategy_brand_idx on public.brand_strategy (brand_id);
alter table public.brand_strategy enable row level security;
create policy "brand_strategy via brand" on public.brand_strategy for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Complementary copy on posts (Stage K). Nullable so existing inserts are unaffected.
alter table public.posts add column if not exists alt_captions jsonb;
alter table public.posts add column if not exists first_comment text;
alter table public.posts add column if not exists hook_variants jsonb;
