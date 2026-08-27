-- Phase 2: Incident tracking for schedule divergences and other anomalies.
-- Each incident is deduplicated per brand+kind+day so owners never get spammed.

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null,           -- 'schedule_divergence', 'zernio_409_mismatch', 'reschedule_time_mismatch', ...
  severity text not null default 'warning',  -- 'info', 'warning', 'critical'
  details jsonb not null default '{}',
  detected_at timestamptz not null default now(),
  notified_at timestamptz,      -- NULL = not yet notified
  resolved_at timestamptz,      -- NULL = open
  created_at timestamptz not null default now(),
  -- Generated date column for dedup (Supabase upsert can't use expression indexes)
  detected_on date generated always as ((detected_at at time zone 'UTC')::date) stored
);

alter table public.incidents enable row level security;

-- Dedup: one incident of the same kind per brand per day
alter table public.incidents
  add constraint incidents_dedup unique (brand_id, kind, detected_on);

-- RLS: service-role only (no user-facing access needed)
create policy incidents_service_role on public.incidents
  for all using (auth.role() = 'service_role');
