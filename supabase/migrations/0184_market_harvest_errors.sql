-- 0184: one row per non-fatal harvest failure, queryable across runs.
--
-- 0183 already stores the run's errors as a jsonb blob, which is fine for reading one tick and
-- useless for the question you actually ask a week later: "which source has been failing, and since
-- when?". That needs rows.
--
-- Service-role only. Deploys do NOT run migrations — apply before shipping code that selects this.

create table if not exists public.market_harvest_errors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.market_harvest_runs(id) on delete cascade,

  -- Where in the pipeline it happened: discovery | media | baseline | observation | label.
  stage text not null,
  -- What it happened to: a source/query, a post id, an account handle.
  target text,
  -- Short machine-ish reason (`too_large`, `http_error`, `too_few_posts`…) pulled off the front of
  -- the message. Indexed, so "all media failures this week, grouped by reason" is one query.
  reason text,
  message text not null,

  occurred_at timestamptz not null default now()
);

create index if not exists market_harvest_errors_stage_idx
  on public.market_harvest_errors (stage, occurred_at desc);
create index if not exists market_harvest_errors_reason_idx
  on public.market_harvest_errors (reason, occurred_at desc);
create index if not exists market_harvest_errors_run_idx
  on public.market_harvest_errors (run_id);

alter table public.market_harvest_errors enable row level security;
