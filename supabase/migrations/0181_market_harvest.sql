-- 0181: daily market harvest — the evidence base for calibrating the content rubric.
--
-- Internal instrument, service-role only (RLS on, no policy — same posture as ai_calls in 0050 and
-- the benchmark tables in 0180). Nothing here is user-facing and nothing is published.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these tables.

-- Posts found by the daily discovery sweep (keyword search, rising sorts).
create table if not exists public.market_posts (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  -- Stable per-platform id. The unique index is what makes a re-run of the sweep idempotent.
  external_id text not null,
  url text,

  -- Handle / subreddit / author name. NOT a user id: it is the grouping key for the engagement
  -- baseline, which is the only thing that makes one post's engagement comparable to another's.
  account_key text,

  content text,
  media_type text,
  format_bucket text,
  published_at timestamptz,

  metrics jsonb not null default '{}'::jsonb,
  -- likes + comments + shares. Views are excluded on purpose (see market-metrics.ts).
  engagement numeric,

  -- THE LABEL: engagement ÷ the account's own median. Null until the account has a baseline —
  -- an unlabelled post is dropped from the fit, never counted as a flop.
  outperformance numeric,

  -- Scored with the same deterministic rubric we score our own output with, so "us vs the field"
  -- is a comparison on one ruler.
  quality_index numeric,
  checks jsonb,
  scorer_version int,

  query text,
  discovered_at timestamptz not null default now(),

  unique (platform, external_id)
);

create index if not exists market_posts_account_idx
  on public.market_posts (platform, account_key, published_at desc);
create index if not exists market_posts_label_idx
  on public.market_posts (scorer_version, outperformance)
  where outperformance is not null;
create index if not exists market_posts_discovered_idx
  on public.market_posts (discovered_at desc);

-- Per-account engagement baseline: the denominator.
create table if not exists public.market_account_baselines (
  platform text not null,
  account_key text not null,
  posts int not null,
  median_engagement numeric not null,

  -- HOW the baseline was computed, and it matters more than the number:
  --   'history'    full recent profile history — an unbiased sample of that account.
  --   'discovered' accumulated from the discovery pool — BIASED HIGH, because discovery surfaces an
  --                account's winners, so the median sits above the account's true typical post and
  --                outperformance computed from it is understated. Usable, but never quote a
  --                'discovered' fit next to a 'history' one without saying which is which.
  -- Only the platforms in scrapecreators' FETCHERS map can reach 'history'; reddit (grouped by
  -- subreddit) and linkedin search results (author name only, no fetchable profile) cannot.
  baseline_source text not null default 'discovered' check (baseline_source in ('history', 'discovered')),

  computed_at timestamptz not null default now(),
  primary key (platform, account_key)
);

alter table public.market_posts enable row level security;
alter table public.market_account_baselines enable row level security;

-- 0180 created benchmark_runs with kind in ('live','golden'); market fits are a third kind.
alter table public.benchmark_runs drop constraint if exists benchmark_runs_kind_check;
alter table public.benchmark_runs
  add constraint benchmark_runs_kind_check check (kind in ('live', 'golden', 'market'));
