-- 0180: internal output benchmark — one deterministic quality sample per published post.
--
-- This is an INTERNAL instrument, not a user-facing feature: it exists so we can answer "did that
-- prompt/model change make the output better or worse" with a number instead of a vibe. Nothing
-- here is published anywhere; the tables are service-role only (RLS on, no policy — same posture
-- as ai_calls in 0050).
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these tables.

-- A named measurement. kind='live' is the continuous stream off published posts; kind='golden' is
-- the frozen set re-run on demand at each change, which is the only cohort where the brand mix is
-- held constant and a delta is attributable to our code.
create table if not exists public.benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'live' check (kind in ('live', 'golden')),
  label text not null,
  release text,
  scorer_version int not null,
  notes text,
  stats jsonb,
  created_at timestamptz not null default now()
);

create index if not exists benchmark_runs_created_idx on public.benchmark_runs (kind, created_at desc);

create table if not exists public.content_quality_samples (
  id uuid primary key default gen_random_uuid(),

  -- Both nullable so a golden run can score generated candidates that were never persisted as
  -- posts. Live samples always carry both; the check below keeps a row from being neither.
  brand_id uuid references public.brands(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  platform text,

  -- Provenance. Without these three a sample is worthless for a before/after: `release` says which
  -- build generated the content, `scorer_version` which rulebook judged it (never mix versions in
  -- one trend line), `run_id` ties it to a frozen eval run instead of the live stream.
  release text,
  scorer_version int not null,
  run_id uuid references public.benchmark_runs(id) on delete set null,

  -- Named `quality_index`, not `index`: the bare word is reserved in SQL and would need quoting at
  -- every call site, which is a footgun waiting for the first raw query.
  quality_index numeric not null,
  checks jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,

  -- Human ground truth captured AT SAMPLE TIME, so the index can be validated against what people
  -- actually did to the post (see correlateWithHumanSignal). A rubric that does not predict edits
  -- is measuring itself.
  revisions_count int,
  post_status text,

  content_created_at timestamptz,
  sampled_at timestamptz not null default now(),

  -- Re-scoring the back-catalogue under a new rulebook must ADD rows, not overwrite history.
  -- Postgres treats NULLs as distinct here, so golden samples (post_id null) never collide.
  unique (post_id, scorer_version),

  -- A sample belongs either to a real post (live stream) or to a named run (golden set).
  constraint content_quality_samples_anchored check (post_id is not null or run_id is not null)
);

create index if not exists content_quality_samples_release_idx
  on public.content_quality_samples (scorer_version, release, sampled_at desc);
create index if not exists content_quality_samples_brand_idx
  on public.content_quality_samples (brand_id, sampled_at desc);
create index if not exists content_quality_samples_run_idx
  on public.content_quality_samples (run_id)
  where run_id is not null;
create index if not exists content_quality_samples_created_idx
  on public.content_quality_samples (content_created_at desc);

-- Service-role only: internal instrumentation, no user-facing reads.
alter table public.content_quality_samples enable row level security;
alter table public.benchmark_runs enable row level security;
