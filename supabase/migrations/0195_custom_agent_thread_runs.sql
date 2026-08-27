-- Which custom agents have run in which chat thread. `last_thread_id` on the schedule
-- only remembers the newest one, so it cannot answer "who ran in this chat" — and a
-- reused thread can collect several agents over time. The sidebar stacks their avatars.

create table if not exists public.custom_agent_thread_runs (
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  schedule_id uuid not null references public.custom_agent_schedules(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  first_run_at timestamptz not null default now(),
  last_run_at timestamptz not null default now(),
  runs integer not null default 1,
  primary key (thread_id, schedule_id)
);

create index if not exists custom_agent_thread_runs_thread_idx
  on public.custom_agent_thread_runs (thread_id, last_run_at desc);

create index if not exists custom_agent_thread_runs_brand_idx
  on public.custom_agent_thread_runs (brand_id);

alter table public.custom_agent_thread_runs enable row level security;

drop policy if exists "custom_agent_thread_runs via brand" on public.custom_agent_thread_runs;
create policy "custom_agent_thread_runs via brand" on public.custom_agent_thread_runs
  for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Backfill what we still know: every schedule's most recent thread.
insert into public.custom_agent_thread_runs (thread_id, schedule_id, brand_id, first_run_at, last_run_at)
select s.last_thread_id, s.id, s.brand_id, coalesce(s.last_run_at, s.created_at), coalesce(s.last_run_at, s.created_at)
from public.custom_agent_schedules s
where s.last_thread_id is not null
on conflict (thread_id, schedule_id) do nothing;
