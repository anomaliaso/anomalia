-- Live snapshot of a chat turn while it is being generated: {text, tools, reasoning, at}.
-- The generation survives the client disconnecting (the server drains its own stream), but nothing
-- recorded what had been produced so far — so a reloaded tab could only spin until the turn ended.
-- The stream drainer writes here about once a second and the job poller replays it, which is what
-- lets a reconnecting client pick the stream back up. Cleared when the turn finishes: from then on
-- the assistant message row is the record.
alter table public.chat_jobs
  add column if not exists partial jsonb;
