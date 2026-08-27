-- Auto-compaction of long chat threads (docs/24 §2.2 / Fase 4).
-- The cut is by timestamp, not id: created_at already orders every existing query.

alter table public.chat_threads
  add column if not exists summary text,
  add column if not exists summary_upto timestamptz,
  add column if not exists summary_message_count integer not null default 0,
  add column if not exists compacted_at timestamptz,
  add column if not exists compact_count integer not null default 0;
