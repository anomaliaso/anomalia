create or replace function public.agent_kit_close_run(
  p_run_id uuid,
  p_to_state text,
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
  where id = p_run_id and state = 'running'
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

revoke all on function public.agent_kit_close_run(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agent_kit_close_run(uuid, text, text, jsonb, jsonb) to service_role;
