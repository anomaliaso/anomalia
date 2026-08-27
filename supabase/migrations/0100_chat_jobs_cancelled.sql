-- Allow explicit cancel of in-flight chat generations (stop button).
-- Previously cancel tried to set status='cancelled' but the check constraint
-- rejected it, so the UI abort never stopped server-side generation/save.
alter table chat_jobs drop constraint chat_jobs_status_check;
alter table chat_jobs add constraint chat_jobs_status_check
  check (status in ('pending', 'running', 'done', 'failed', 'cancelled'));

-- Speeds up "is this thread still generating?" lookups when remounting the chat.
create index if not exists idx_chat_jobs_thread_status
  on chat_jobs (thread_id, status)
  where thread_id is not null;
