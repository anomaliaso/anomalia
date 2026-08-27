-- Chat message metadata: timing, model, sources, feedback, redo (superseded).
-- Phase 0 needs superseded + UPDATE policy; the rest lands with Phase 1 UI.

alter table public.chat_messages
  add column if not exists duration_ms integer,
  add column if not exists model text,
  add column if not exists tier text,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists sources jsonb,
  add column if not exists feedback smallint,
  add column if not exists feedback_note text,
  add column if not exists feedback_at timestamptz,
  add column if not exists regenerated_from uuid references public.chat_messages(id) on delete set null,
  add column if not exists superseded boolean not null default false;

do $$ begin
  alter table public.chat_messages add constraint chat_messages_feedback_check
    check (feedback in (-1, 1));
exception when duplicate_object then null; end $$;

create index if not exists chat_messages_feedback_idx
  on public.chat_messages (brand_id, feedback) where feedback is not null;

-- History excludes superseded versions: index on the real access path.
create index if not exists chat_messages_thread_live_idx
  on public.chat_messages (thread_id, created_at) where superseded = false;

-- 0043 covers select/insert/delete. UPDATE is required for feedback and superseded.
-- create policy is not idempotent — drop first, like 0108/0109.
drop policy if exists "chat_messages_update" on public.chat_messages;
create policy "chat_messages_update" on public.chat_messages for update
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid())
  with check (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());
