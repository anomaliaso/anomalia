-- Lifecycle drip dedup ledger: one row per (brand, step) once that step's email has been sent,
-- so the every-10-min cron (api/v1/lifecycle/tick) never sends the same step twice.
-- Steps: 'welcome' (T+0), 'day1_call', 'day2_step', 'day3_step'.
create table if not exists public.lifecycle_emails (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  step text not null,
  sent_at timestamptz not null default now(),
  unique (brand_id, step)
);

create index if not exists lifecycle_emails_brand_idx on public.lifecycle_emails(brand_id);

alter table public.lifecycle_emails enable row level security;
-- No policies: only the service-role cron reads/writes this. RLS on + no policy = locked to service role.

-- Off by default; flip to true once tested via ?brand=<slug> to turn on the scheduled run for everyone.
insert into public.app_flags (key, enabled) values ('lifecycle_emails', false) on conflict (key) do nothing;
