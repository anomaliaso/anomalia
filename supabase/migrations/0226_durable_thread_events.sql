alter table public.chat_threads
  add column if not exists event_head_seq bigint not null default 0;

create table if not exists public.thread_events (
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  seq bigint not null,
  source_key text not null,
  kind text not null check (kind in ('message', 'progress', 'messages_superseded')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (thread_id, seq),
  unique (thread_id, source_key)
);

create index if not exists idx_thread_events_source
  on public.thread_events(thread_id, source_key);

create index if not exists idx_thread_events_kind
  on public.thread_events(thread_id, kind, seq);

alter table public.thread_events enable row level security;

drop policy if exists thread_events_select on public.thread_events;
create policy thread_events_select on public.thread_events for select
  using (
    thread_id in (
      select id
      from public.chat_threads
      where brand_id in (select public.auth_brand_ids())
        and user_id = auth.uid()
    )
  );

revoke all on public.thread_events from anon, authenticated;
grant select on public.thread_events to authenticated;

insert into public.thread_events (thread_id, seq, source_key, kind, payload, created_at)
select
  m.thread_id,
  row_number() over (partition by m.thread_id order by m.created_at, m.id),
  'backfill:message:' || m.id,
  'message',
  to_jsonb(m),
  m.created_at
from public.chat_messages m
on conflict (thread_id, source_key) do nothing;

update public.chat_threads t
set event_head_seq = coalesce(
  (select max(e.seq) from public.thread_events e where e.thread_id = t.id),
  0
);

create or replace function public.append_thread_event(
  p_thread_id uuid,
  p_source_key text,
  p_kind text,
  p_payload jsonb
) returns public.thread_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread public.chat_threads%rowtype;
  v_event public.thread_events%rowtype;
begin
  if p_kind not in ('message', 'progress', 'messages_superseded') then
    raise exception 'thread event kind is not supported';
  end if;

  select * into v_thread
  from public.chat_threads
  where id = p_thread_id
  for update;

  if v_thread.id is null then
    raise exception 'thread not found';
  end if;

  if auth.role() <> 'service_role' and v_thread.user_id <> auth.uid() then
    raise exception 'thread access denied';
  end if;

  select * into v_event
  from public.thread_events
  where thread_id = p_thread_id and source_key = p_source_key;

  if v_event.thread_id is not null then
    if v_event.kind <> p_kind or v_event.payload is distinct from p_payload then
      raise exception 'thread event source key conflict';
    end if;
    return v_event;
  end if;

  insert into public.thread_events (thread_id, seq, source_key, kind, payload)
  values (p_thread_id, v_thread.event_head_seq + 1, p_source_key, p_kind, p_payload)
  returning * into v_event;

  update public.chat_threads
  set event_head_seq = v_event.seq
  where id = p_thread_id;

  return v_event;
end;
$$;

revoke all on function public.append_thread_event(uuid, text, text, jsonb) from public, anon;
grant execute on function public.append_thread_event(uuid, text, text, jsonb) to authenticated, service_role;

create or replace function public.capture_chat_message_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.thread_id is null then
    return new;
  end if;

  perform public.append_thread_event(
    new.thread_id,
    'message:' || new.id,
    'message',
    to_jsonb(new)
  );
  return new;
end;
$$;

create or replace function public.capture_chat_message_supersede_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.superseded is false and new.superseded is true and new.thread_id is not null then
    perform public.append_thread_event(
      new.thread_id,
      'supersede:' || new.id,
      'messages_superseded',
      jsonb_build_object('messageIds', jsonb_build_array(new.id))
    );
  end if;
  return new;
end;
$$;

drop trigger if exists chat_messages_capture_event on public.chat_messages;
create trigger chat_messages_capture_event
after insert on public.chat_messages
for each row execute function public.capture_chat_message_event();

drop trigger if exists chat_messages_capture_supersede on public.chat_messages;
create trigger chat_messages_capture_supersede
after update of superseded on public.chat_messages
for each row execute function public.capture_chat_message_supersede_event();

revoke all on function public.capture_chat_message_event() from public, anon, authenticated;
revoke all on function public.capture_chat_message_supersede_event() from public, anon, authenticated;
