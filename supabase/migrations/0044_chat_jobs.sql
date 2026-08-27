-- 0042 Async chat jobs for heavy operations
--
-- Heavy chat tools (discover_competitors, reanalyze_brand, etc.) run asynchronously.
-- The tool creates a job row, fires a background fetch, and returns immediately.
-- The background runner executes the tool, writes the result to chat_messages, and
-- updates the job status. The ChatWidget polls for new messages to show results.

create table chat_jobs (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  tool_name    text not null,
  input_params jsonb,
  status       text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_chat_jobs_user on chat_jobs(user_id, created_at desc);

alter table chat_jobs enable row level security;

create policy "chat_jobs_select" on chat_jobs for select
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

create policy "chat_jobs_insert" on chat_jobs for insert
  with check (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

create policy "chat_jobs_update" on chat_jobs for update
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());
