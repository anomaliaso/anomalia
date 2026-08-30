-- Il recinto del lease smette di essere facoltativo.
--
-- La 0229 aveva dato un default a `p_owner`/`p_fence` per una ragione sola: fra l'applicazione
-- della migration e il deploy del codice che passa il lease, la produzione chiamava ancora la
-- firma a cinque argomenti, e senza default ogni chiusura di turno sarebbe fallita — cioè il
-- momento in cui la risposta viene salvata. Quella finestra è chiusa: il codice in produzione
-- passa proprietario e fence (run-store.ts). Da qui una chiamata senza lease è un errore, non
-- una chiusura senza recinto.

create or replace function public.agent_kit_close_run(
  p_run_id uuid,
  p_to_state text,
  -- I parametri col default DEVONO stare in fondo, quindi il lease passa davanti. Chi chiama usa
  -- i nomi (supabase-js manda un oggetto), perciò l'ordine non tocca nessuno.
  p_owner text,
  p_fence bigint,
  p_reason text default null,
  p_question jsonb default null,
  p_message jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.agent_kit_runs%rowtype;
  v_message public.chat_messages%rowtype;
begin
  if p_to_state not in ('waiting_input', 'done', 'failed', 'aborted') then
    raise exception 'agent_kit_close_run: state is not allowed';
  end if;

  update public.agent_kit_runs
  set state = p_to_state,
      reason = coalesce(p_reason, reason),
      question = coalesce(p_question, question),
      harness_continue_state = null,
      updated_at = now()
  where id = p_run_id
    and state = 'running'
    and lease_owner = p_owner
    and lease_fence = p_fence
  returning * into v_run;

  if v_run.id is null then
    return jsonb_build_object('closed', false);
  end if;

  if p_message is not null then
    insert into public.chat_messages (brand_id, user_id, thread_id, role, content, reasoning, tool_calls, attachments, name)
    values (
      v_run.brand_id,
      v_run.user_id,
      v_run.thread_id,
      'assistant',
      coalesce(p_message->>'content', ''),
      p_message->>'reasoning',
      p_message->'tool_calls',
      p_message->'attachments',
      p_message->>'name'
    )
    returning * into v_message;

    update public.agent_kit_runs
    set partial_saved_msg_id = v_message.id
    where id = p_run_id;

  end if;

  if v_run.thread_id is not null then
    perform public.append_thread_event(
      v_run.thread_id,
      'run:' || p_run_id || ':state:' || p_to_state,
      'progress',
      jsonb_build_object(
        'runId', p_run_id,
        'status', p_to_state,
        'reason', p_reason,
        'question', p_question
      )
    );
  end if;

  return jsonb_build_object('closed', true, 'message_id', v_message.id);
end;
$$;

-- La firma vecchia se ne va: quella nuova ha un ordine di tipi diverso, e tenerle entrambe
-- renderebbe ambigua ogni chiamata per nome.
drop function if exists public.agent_kit_close_run(uuid, text, text, jsonb, jsonb, text, bigint);

revoke all on function public.agent_kit_close_run(uuid, text, text, bigint, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agent_kit_close_run(uuid, text, text, bigint, text, jsonb, jsonb) to service_role;
