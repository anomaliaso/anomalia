-- 0199: a chat thread can belong to a maker surface, not only to the chat page.
--
-- Motion Video, the Media Generator and the UGC planner ran outside the chat entirely: their turns
-- streamed to a workbench, were mirrored into a designer job for continuation, and then vanished.
-- Nothing appeared in the sidebar, nothing could be reopened, and the work done in those pages was
-- invisible to the agent the next time you talked to it.
--
-- 0094 already scoped a thread to a post (`post_id`) for the per-post editor — this is the same
-- idea generalised: which surface opened the thread, and what it was working on there.
--
--   surface      'motion' | 'media' | 'ugc'  (null = the chat page itself)
--   surface_key  the thing being worked on — a motion video id, a UGC run id, …
--
-- One thread per (user, surface, key) so a second turn on the same video continues the same
-- conversation instead of littering the sidebar. Threads with no key (a brand-new composition that
-- has no id yet) are exempt from the constraint and get their key when the row is created.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

alter table public.chat_threads add column if not exists surface text;
alter table public.chat_threads add column if not exists surface_key text;

create unique index if not exists chat_threads_surface_key_idx
  on public.chat_threads (brand_id, user_id, surface, surface_key)
  where surface is not null and surface_key is not null;

create index if not exists chat_threads_surface_idx
  on public.chat_threads (brand_id, user_id, surface, updated_at desc)
  where surface is not null;
