-- SEO/GEO effectiveness: GSC, rank tracking, site crawl SEO columns, GEO opportunities,
-- hosted site pages, external backlink orders.

-- ── Google Search Console ────────────────────────────────────────────────────
create table if not exists public.brand_gsc_connections (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  site_url text,
  permission_level text,
  active boolean not null default true,
  synced_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.brand_gsc_connections enable row level security;
create policy "gsc connections via brand" on public.brand_gsc_connections for select
  using (brand_id in (select public.auth_brand_ids()));

create table if not exists public.brand_gsc_metrics (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  date date not null,
  query text not null default '',
  page text not null default '',
  country text not null default '',
  device text not null default '',
  clicks numeric not null default 0,
  impressions numeric not null default 0,
  ctr numeric not null default 0,
  position numeric not null default 0,
  unique (brand_id, date, query, page, country, device)
);
create index if not exists brand_gsc_metrics_brand_date_idx on public.brand_gsc_metrics (brand_id, date desc);
create index if not exists brand_gsc_metrics_brand_query_idx on public.brand_gsc_metrics (brand_id, query);
create index if not exists brand_gsc_metrics_brand_page_idx on public.brand_gsc_metrics (brand_id, page);
alter table public.brand_gsc_metrics enable row level security;
create policy "gsc metrics via brand" on public.brand_gsc_metrics for select
  using (brand_id in (select public.auth_brand_ids()));

-- ── Rank tracker ─────────────────────────────────────────────────────────────
create table if not exists public.brand_tracked_keywords (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  keyword text not null,
  locale text not null default 'en',
  location_code integer not null default 2840,
  device text not null default 'desktop',
  source text not null default 'manual', -- strategy | gsc | manual
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (brand_id, keyword, locale, device)
);
create index if not exists brand_tracked_keywords_brand_idx on public.brand_tracked_keywords (brand_id, active);
alter table public.brand_tracked_keywords enable row level security;
create policy "tracked keywords via brand" on public.brand_tracked_keywords for select
  using (brand_id in (select public.auth_brand_ids()));
create policy "tracked keywords write via brand" on public.brand_tracked_keywords for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

create table if not exists public.brand_rank_snapshots (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  tracked_keyword_id uuid not null references public.brand_tracked_keywords(id) on delete cascade,
  checked_at timestamptz not null default now(),
  position integer, -- null = not in top 100
  url text,
  serp_features jsonb not null default '{}'::jsonb,
  dfs_cost_usd numeric not null default 0
);
create index if not exists brand_rank_snapshots_kw_idx on public.brand_rank_snapshots (tracked_keyword_id, checked_at desc);
create index if not exists brand_rank_snapshots_brand_idx on public.brand_rank_snapshots (brand_id, checked_at desc);
alter table public.brand_rank_snapshots enable row level security;
create policy "rank snapshots via brand" on public.brand_rank_snapshots for select
  using (brand_id in (select public.auth_brand_ids()));

-- ── Site crawl SEO columns + runs ────────────────────────────────────────────
alter table public.brand_pages add column if not exists http_status integer;
alter table public.brand_pages add column if not exists canonical text;
alter table public.brand_pages add column if not exists robots_meta text;
alter table public.brand_pages add column if not exists h1 text;
alter table public.brand_pages add column if not exists word_count integer;
alter table public.brand_pages add column if not exists internal_in_links integer;
alter table public.brand_pages add column if not exists internal_out_links integer;
alter table public.brand_pages add column if not exists has_schema boolean;
alter table public.brand_pages add column if not exists hreflang jsonb;
alter table public.brand_pages add column if not exists issues jsonb;
alter table public.brand_pages add column if not exists seo_score integer;
alter table public.brand_pages add column if not exists crawled_at timestamptz;

create table if not exists public.brand_crawl_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_crawled integer not null default 0,
  summary jsonb not null default '{}'::jsonb
);
create index if not exists brand_crawl_runs_brand_idx on public.brand_crawl_runs (brand_id, started_at desc);
alter table public.brand_crawl_runs enable row level security;
create policy "crawl runs via brand" on public.brand_crawl_runs for select
  using (brand_id in (select public.auth_brand_ids()));

-- ── GEO citation opportunities (closed loop) ─────────────────────────────────
create table if not exists public.brand_geo_opportunities (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  prompt text not null,
  engine text not null default '',
  status text not null default 'open', -- open | in_progress | applied | won | lost | dismissed
  baseline_cited boolean not null default false,
  baseline_audit_id uuid,
  target_url text,
  blog_article_id uuid,
  action text, -- rewrite_page | new_article | artifact_faq | schema
  applied_at timestamptz,
  reprobe_cited boolean,
  reprobe_at timestamptz,
  delta_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brand_geo_opportunities_brand_status_idx
  on public.brand_geo_opportunities (brand_id, status, created_at desc);
alter table public.brand_geo_opportunities enable row level security;
create policy "geo opportunities via brand" on public.brand_geo_opportunities for select
  using (brand_id in (select public.auth_brand_ids()));
create policy "geo opportunities write via brand" on public.brand_geo_opportunities for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- ── Hosted SEO site pages (landings / comparisons / glossary) ────────────────
create table if not exists public.brand_site_pages (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null default 'landing_page', -- landing_page | comparison | glossary | programmatic | free_tool
  slug text not null,
  title text not null,
  body_md text not null default '',
  target_query text,
  status text not null default 'draft', -- draft | published
  initiative_id text,
  seo_meta jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, slug)
);
create index if not exists brand_site_pages_brand_status_idx on public.brand_site_pages (brand_id, status);
alter table public.brand_site_pages enable row level security;
create policy "site pages via brand" on public.brand_site_pages for select
  using (brand_id in (select public.auth_brand_ids()));
create policy "site pages write via brand" on public.brand_site_pages for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- ── External backlink orders ─────────────────────────────────────────────────
create table if not exists public.brand_backlink_orders (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  provider text not null default 'manual', -- submitforbacklinks | manual
  target_url text not null,
  topic text,
  status text not null default 'pending', -- pending | submitted | completed | failed | cancelled
  provider_ref text,
  cost_credits integer not null default 0,
  resulting_links jsonb not null default '[]'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brand_backlink_orders_brand_idx on public.brand_backlink_orders (brand_id, created_at desc);
alter table public.brand_backlink_orders enable row level security;
create policy "backlink orders via brand" on public.brand_backlink_orders for select
  using (brand_id in (select public.auth_brand_ids()));
create policy "backlink orders write via brand" on public.brand_backlink_orders for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
