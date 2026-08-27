-- 0017 autopilot: recurring per-brand generation (scheduler_runs audit trail + brand config).
-- A daily tick (pg_cron or external scheduler) calls /api/v1/autopilot/tick, which runs each due
-- brand: it plans a fresh batch from the brand's STORED profile, persists pending_user posts,
-- then auto-publishes to accounts flagged auto_publish and emails a one-tap approval for the rest.
-- NOT YET APPLIED — written for review; apply via MCP and record the project/date here.

-- scheduler_runs is a separate table (not just a column on brands) because it's an audit
-- trail: every recurring run records its own outcome (status, error, posts_created) so we can
-- debug failures, retry, and trace exactly which posts a given run produced (posts.scheduler_run_id).
create type scheduler_run_status as enum ('pending', 'completed', 'failed');

create table public.scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  status scheduler_run_status not null default 'pending',
  error text,
  posts_created int not null default 0,
  created_at timestamptz not null default now()
);

create index scheduler_runs_brand_idx on public.scheduler_runs (brand_id);
create index scheduler_runs_created_idx on public.scheduler_runs (created_at desc);

alter table public.scheduler_runs enable row level security;
-- Standard brand-scoped policy: the owner can read their runs in the UI; the tick endpoint
-- uses the service-role client (bypasses RLS) to write across all brands.
create policy "scheduler_runs via brand" on public.scheduler_runs for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Brand autopilot config: opt-in flag, last successful run time (drives the "due" check in the
-- tick endpoint), and a consecutive-failure counter. On 3 consecutive failures the tick
-- auto-disables autopilot (flips autopilot_enabled to false) so a persistently broken brand
-- kit doesn't spam the owner forever — re-enabling is a manual action.
alter table public.brands add column if not exists autopilot_enabled boolean not null default false;
alter table public.brands add column if not exists last_autopilot_run_at timestamptz;
alter table public.brands add column if not exists autopilot_failure_count int not null default 0;

-- Posts tie back to the scheduler_run that created them (audit, retry, or bulk deletion of a
-- run's output). on delete set null keeps the posts if a run row is ever pruned.
alter table public.posts add column if not exists scheduler_run_id uuid references public.scheduler_runs(id) on delete set null;
create index posts_scheduler_run_idx on public.posts (scheduler_run_id);

-- NOTE: social_accounts.auto_publish already exists (migration 0005) — no change needed here.
-- It controls whether autopilot posts for that account go straight to Zernio (auto-publish)
-- or wait for the owner's one-tap email approval.
-- NOTE: per-brand monthly post/video usage already tracked in brand_usage (migration 0014);
-- autopilot reuses it for the same hard quota + invisible video guardrail as the manual path.
