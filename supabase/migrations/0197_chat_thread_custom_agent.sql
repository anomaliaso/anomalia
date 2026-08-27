-- A chat can be bound to one of the user's custom agents, picked from the composer.
-- Its prompt then rides along as the persona for every turn in that thread.

alter table public.chat_threads
  add column if not exists custom_agent_id uuid
  references public.custom_agent_schedules(id) on delete set null;

create index if not exists chat_threads_custom_agent_idx
  on public.chat_threads (custom_agent_id)
  where custom_agent_id is not null;
