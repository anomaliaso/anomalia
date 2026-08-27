-- 0183: permanent copies of harvested media + a run log with the analysis counters.
--
-- WHY THE ARCHIVE. Every media URL a platform hands back is a signed CDN link that dies within days
-- (media-archive.ts says as much at the top). A harvested post whose media is a dead link is half a
-- record: the text survives, the thing the text was wrapped around does not — and a video judge
-- cannot re-score what it can no longer fetch. Archiving while the link is alive is the only window.
--
-- Service-role only. Deploys do NOT run migrations — apply before shipping code that selects these.

alter table public.market_posts
  -- Original platform URL. Kept for provenance; expect it to rot.
  add column if not exists media_url text;
alter table public.market_posts
  -- Our permanent copy: a path in the brand-knowledge bucket, signed on read. This is the link that
  -- is meant to outlive the platform's.
  add column if not exists media_path text;
alter table public.market_posts
  add column if not exists media_bytes bigint;
alter table public.market_posts
  add column if not exists media_kind text check (media_kind is null or media_kind in ('image', 'video'));
alter table public.market_posts
  add column if not exists media_archived_at timestamptz;

-- How many times this post's CONTENT has been scored. 1 = analysed once; >1 = re-analysed, which
-- happens when the sweep sees it again or the rubric version moved under it.
alter table public.market_posts
  add column if not exists analysis_count int not null default 0;
alter table public.market_posts
  add column if not exists last_analyzed_at timestamptz;

create index if not exists market_posts_media_idx
  on public.market_posts (media_archived_at desc)
  where media_path is not null;

-- One row per harvest tick. A bare counter tells you a total; a run log tells you the shape of the
-- pipeline over time — which source dried up, when re-analysis overtook discovery, what the media
-- archive actually costs per day.
create table if not exists public.market_harvest_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,

  -- Discovery
  discovered int not null default 0,
  posts_new int not null default 0,
  posts_reobserved int not null default 0,

  -- Analysis
  analyzed_new int not null default 0,
  analyzed_again int not null default 0,

  -- Media archive
  media_archived int not null default 0,
  media_bytes bigint not null default 0,
  media_failed int not null default 0,

  -- Baselines and labels
  baselines_history int not null default 0,
  baselines_discovered int not null default 0,
  labelled int not null default 0,

  -- Measured posts per source and category. These endpoints' page sizes are undocumented (only
  -- Threads is known, "up to 10 per query"), so the real yield is recorded rather than assumed.
  yields jsonb,
  categories text[],

  -- Everything that failed WITHOUT stopping the run: dead search endpoints, media that would not
  -- archive, account histories that would not fetch. This is the column that distinguishes a quiet
  -- day from a broken one — without it both look like "few posts today".
  errors jsonb,
  error_count int not null default 0,

  -- Set only when the whole tick threw.
  error text
);

create index if not exists market_harvest_runs_started_idx
  on public.market_harvest_runs (started_at desc);

alter table public.market_harvest_runs enable row level security;
