-- 0041 AI chatbot conversation persistence
--
-- The dashboard chat widget lets users talk to an AI content strategist that can read and write
-- every brand domain (kit, strategy, plan, posts, products, people). Conversations persist across
-- page navigations so the user doesn't lose context when switching between dashboard sub-pages.

create table chat_messages (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content    text not null default '',
  -- For assistant messages that invoked tools: the tool_calls array from the AI SDK
  tool_calls jsonb,
  -- For tool result messages: which tool call this is a response to
  tool_call_id text,
  -- For tool messages: the tool name (e.g. 'read_brand_kit')
  name       text,
  created_at timestamptz not null default now()
);

-- Fast history load: latest N messages for a brand+user pair
create index idx_chat_messages_brand_user
  on chat_messages(brand_id, user_id, created_at desc);

-- RLS: scoped to the user's own brands, same pattern as every other table
alter table chat_messages enable row level security;

create policy "chat_messages_select" on chat_messages for select
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

create policy "chat_messages_insert" on chat_messages for insert
  with check (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

create policy "chat_messages_delete" on chat_messages for delete
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());
