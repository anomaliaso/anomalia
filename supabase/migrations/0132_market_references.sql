-- Weekly market video/social references: top competitor (and adjacent) posts distilled into a
-- format/hook catalog the planner and chat consume. Refreshed at most weekly to control scrape + AI cost.
create table if not exists public.brand_market_references (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade unique,
  -- MarketReference[]: caption, platform, media, engagement, archived thumb, distilled tags.
  -- QUOTED: `references` is a reserved word — unquoted it is a syntax error here. PostgREST quotes
  -- identifiers, so market-references.ts keeps reading/writing it as a plain `references` field.
  "references" jsonb not null default '[]'::jsonb,
  -- FormatCatalog: named formats, hook patterns, angles, how-to-adapt
  catalog jsonb not null default '{}'::jsonb,
  summary text,
  -- Which competitor handles were scraped this run
  sources jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brand_market_references_brand_idx on public.brand_market_references (brand_id);
alter table public.brand_market_references enable row level security;

-- Members read; writes are service-role (cron / ensureMarketReferences).
create policy "market references via brand" on public.brand_market_references for select
  using (brand_id in (select public.auth_brand_ids()));
