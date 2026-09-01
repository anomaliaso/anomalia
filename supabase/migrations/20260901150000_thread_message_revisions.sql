-- Il log degli eventi vedeva solo l'INSERT di chat_messages. Il checkpoint del battito
-- (bridge/live.ts) inserisce la riga dell'assistente VUOTA e poi la aggiorna a ogni battito, quindi
-- il log teneva la fotografia iniziale: un thread reale aveva 60.700 caratteri di reasoning e 10.236
-- di tool_calls nella riga, e zero nell'evento che la UI legge. Il turno risultava scomparso.
--
-- Un evento non si riscrive (append_thread_event solleva sul payload diverso, ed è giusto: il log è
-- immutabile). La revisione è un evento NUOVO, con la sua source_key, e il reducer sostituisce il
-- messaggio con lo stesso id invece di accodarlo. Della revisione se ne tiene UNA: il payload è la
-- riga intera, e un turno lungo ne produce decine.

create or replace function public.append_thread_message_revision(
  p_thread_id uuid,
  p_message_id uuid,
  p_payload jsonb
)
returns public.thread_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread public.chat_threads%rowtype;
  v_event public.thread_events%rowtype;
  v_origin text := 'message:' || p_message_id;
begin
  select * into v_thread
  from public.chat_threads
  where id = p_thread_id
  for update;

  if v_thread.id is null then
    raise exception 'thread not found';
  end if;

  -- Nessuna revisione prima dell'originale: senza l'evento di INSERT il messaggio non esiste per
  -- il reducer, e una revisione da sola lo farebbe comparire fuori dal suo posto.
  if not exists (
    select 1 from public.thread_events
    where thread_id = p_thread_id and source_key = v_origin
  ) then
    return null;
  end if;

  delete from public.thread_events
  where thread_id = p_thread_id and source_key like v_origin || ':r%';

  insert into public.thread_events (thread_id, seq, source_key, kind, payload)
  values (
    p_thread_id,
    v_thread.event_head_seq + 1,
    v_origin || ':r' || (v_thread.event_head_seq + 1),
    'message',
    p_payload
  )
  returning * into v_event;

  update public.chat_threads
  set event_head_seq = v_event.seq
  where id = p_thread_id;

  return v_event;
end;
$$;

revoke all on function public.append_thread_message_revision(uuid, uuid, jsonb) from public, anon;
grant execute on function public.append_thread_message_revision(uuid, uuid, jsonb) to authenticated, service_role;

create or replace function public.capture_chat_message_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.thread_id is null then
    return new;
  end if;

  -- `update of` scatta anche quando il valore riscritto è identico: un checkpoint che non ha
  -- aggiunto niente non deve costare un evento da 60 kB.
  if new.content is not distinct from old.content
     and new.reasoning is not distinct from old.reasoning
     and new.tool_calls is not distinct from old.tool_calls then
    return new;
  end if;

  perform public.append_thread_message_revision(new.thread_id, new.id, to_jsonb(new));
  return new;
end;
$$;

drop trigger if exists chat_messages_capture_revision on public.chat_messages;
create trigger chat_messages_capture_revision
after update of content, reasoning, tool_calls on public.chat_messages
for each row execute function public.capture_chat_message_revision();

revoke all on function public.capture_chat_message_revision() from public, anon, authenticated;
