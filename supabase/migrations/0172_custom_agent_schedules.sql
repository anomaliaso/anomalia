-- Recurring custom agents: a user-authored prompt that runs as a background chat
-- on chosen weekdays + times (brand timezone). Each fire is a queued chat_response.

create table if not exists public.custom_agent_schedules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  prompt text not null,
  agent text,
  enabled boolean not null default true,
  days_of_week smallint[] not null,
  times text[] not null,
  reuse_thread boolean not null default false,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_thread_id uuid references public.chat_threads(id) on delete set null,
  last_job_id uuid,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_agent_schedules_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint custom_agent_schedules_prompt_len check (char_length(btrim(prompt)) between 1 and 8000),
  constraint custom_agent_schedules_days check (
    cardinality(days_of_week) between 1 and 7
    and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  constraint custom_agent_schedules_times_len check (cardinality(times) between 1 and 12)
);

create index if not exists custom_agent_schedules_due_idx
  on public.custom_agent_schedules (next_run_at)
  where enabled = true;

create index if not exists custom_agent_schedules_brand_idx
  on public.custom_agent_schedules (brand_id, created_at desc);

alter table public.custom_agent_schedules enable row level security;

drop policy if exists "custom_agent_schedules via brand" on public.custom_agent_schedules;
create policy "custom_agent_schedules via brand" on public.custom_agent_schedules
  for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
