-- Model-visible agent transcripts: one row per generateText / streamText / consult turn.
-- Separate from agent_runs (summaries) and ai_calls (billing). Writes are service-role only.

create table if not exists public.agent_sessions (
  id uuid primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  user_id uuid,
  thread_id uuid,
  job_id uuid,
  agent text not null,
  mode text not null default '',
  surface text not null default 'batch',
  status text not null default 'running',
  model text,
  provider text,
  system_prompt text,
  transcript text not null default '',
  events jsonb not null default '[]'::jsonb,
  event_count int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Shape of `events`/`transcript`. Bump when the encoding changes so a reader can tell an old
  -- row from a new one instead of guessing. Matches the table already applied on Supabase.
  format_version int not null default 1
);

create index if not exists agent_sessions_brand_created_idx
  on public.agent_sessions (brand_id, created_at desc);

create index if not exists agent_sessions_brand_agent_idx
  on public.agent_sessions (brand_id, agent, created_at desc);

create index if not exists agent_sessions_thread_idx
  on public.agent_sessions (thread_id, created_at desc)
  where thread_id is not null;

alter table public.agent_sessions enable row level security;

drop policy if exists "agent_sessions readable by brand members" on public.agent_sessions;
create policy "agent_sessions readable by brand members" on public.agent_sessions
  for select using (brand_id in (select public.auth_brand_ids()));
