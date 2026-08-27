-- Agent run telemetry (strategy / week-planner / GTM loops).
-- Separate from ai_calls: one row per agent SESSION, not per LLM call.
-- ai_calls remains the billing + per-call observability source of truth.

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  user_id uuid,
  agent text not null,
  mode text not null,
  status text not null,
  finished_ok boolean not null default false,
  notes text,
  citations jsonb,
  steps jsonb,
  violations jsonb,
  cost_usd_estimate numeric,
  created_at timestamptz not null default now()
);

create index if not exists agent_runs_brand_created_idx on public.agent_runs (brand_id, created_at desc);
create index if not exists agent_runs_agent_created_idx on public.agent_runs (agent, created_at desc);

alter table public.agent_runs enable row level security;
