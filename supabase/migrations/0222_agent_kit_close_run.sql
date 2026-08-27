-- DA APPLICARE A MANO: i deploy di questo repo non eseguono le migration.
--
-- La chiusura del turno kit diventa UNA transazione. Prima il bridge (live.ts) salvava il
-- messaggio in chat e POI faceva il compare-and-swap sullo stato del run: un worker già
-- dichiarato morto dal reaper (o sfrattato da un secondo worker) perdeva il CAS ma aveva GIÀ
-- depositato la sua riga — la causa radice dei doppioni in chat che `recoverDeadPartial`
-- deduplica a valle. Qui il CAS su `state='running'` fa da recinto per TUTTE le scritture
-- terminali: se il run non è più nostro, non si scrive niente e si torna `closed:false`.
--
-- Il fence è lo stato stesso, senza colonne nuove: uno sfratto passa SEMPRE da un cambio di
-- stato (reaper → aborted), e su un run in `running` c'è un solo worker per segmento (il CAS
-- di `resume()` e il guard `liveRunningRun` impediscono il secondo).
--
-- `partial_saved_msg_id` (0219) si valorizza NELLA stessa transazione dell'insert: sparisce la
-- corsa "messaggio a terra, marcatore non ancora" che il reaper copriva con l'ilike sul testo.

create or replace function public.agent_kit_close_run(
  p_run_id uuid,
  p_to_state text,
  p_reason text default null,
  p_question jsonb default null,
  p_message jsonb default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_run public.agent_kit_runs%rowtype;
  v_msg_id uuid;
begin
  -- Le sole transizioni ammesse da 'running' (contracts.ts, assertTransition).
  if p_to_state not in ('waiting_input', 'done', 'failed', 'aborted') then
    raise exception 'agent_kit_close_run: stato di arrivo non ammesso da running: %', p_to_state;
  end if;

  update public.agent_kit_runs
     set state = p_to_state,
         reason = coalesce(p_reason, reason),
         question = coalesce(p_question, question),
         updated_at = now()
   where id = p_run_id
     and state = 'running'
   returning * into v_run;

  if v_run.id is null then
    return jsonb_build_object('closed', false);
  end if;

  if p_message is not null then
    insert into public.chat_messages (brand_id, user_id, thread_id, role, content, reasoning, tool_calls, attachments)
    values (
      v_run.brand_id,
      v_run.user_id,
      v_run.thread_id,
      'assistant',
      coalesce(p_message->>'content', ''),
      p_message->>'reasoning',
      p_message->'tool_calls',
      p_message->'attachments'
    )
    returning id into v_msg_id;

    update public.agent_kit_runs set partial_saved_msg_id = v_msg_id where id = p_run_id;
  end if;

  return jsonb_build_object('closed', true, 'message_id', v_msg_id);
end;
$$;

-- Scrive su due tabelle scavalcando le policy del chiamante: solo il service role la esegue.
revoke all on function public.agent_kit_close_run(uuid, text, text, jsonb, jsonb) from public;
revoke all on function public.agent_kit_close_run(uuid, text, text, jsonb, jsonb) from anon, authenticated;
grant execute on function public.agent_kit_close_run(uuid, text, text, jsonb, jsonb) to service_role;
