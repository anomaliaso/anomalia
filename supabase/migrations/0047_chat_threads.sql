-- 0047 Multi-thread chat per brand
--
-- Each brand can now have multiple independent chat conversations (threads).
-- The chat_messages table gains a thread_id FK so messages are scoped to a thread.
-- Existing messages are migrated to a default "Chat principale" thread.

-- 1. Create the chat_threads table
create table chat_threads (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'Nuova chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_chat_threads_brand_user
  on chat_threads(brand_id, user_id, updated_at desc);

alter table chat_threads enable row level security;

create policy "chat_threads_select" on chat_threads for select
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

create policy "chat_threads_insert" on chat_threads for insert
  with check (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

create policy "chat_threads_update" on chat_threads for update
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

create policy "chat_threads_delete" on chat_threads for delete
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

-- 2. Add thread_id to chat_messages
alter table chat_messages add column thread_id uuid references chat_threads(id) on delete cascade;

create index idx_chat_messages_thread
  on chat_messages(thread_id, created_at);

-- 3. Add thread_id to chat_jobs
alter table chat_jobs add column thread_id uuid references chat_threads(id) on delete set null;

-- 4. Migrate existing messages: create a default thread per brand+user pair and link messages
do $$
declare
  r record;
  new_thread_id uuid;
begin
  for r in
    select distinct brand_id, user_id from chat_messages where thread_id is null
  loop
    insert into chat_threads (brand_id, user_id, title)
    values (r.brand_id, r.user_id, 'Chat principale')
    returning id into new_thread_id;

    update chat_messages
      set thread_id = new_thread_id
      where brand_id = r.brand_id and user_id = r.user_id and thread_id is null;
  end loop;
end $$;

-- 5. Make thread_id NOT NULL after migration
alter table chat_messages alter column thread_id set not null;
