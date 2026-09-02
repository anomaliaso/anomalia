alter table public.agent_kit_runs
  add column if not exists lease_owner text,
  add column if not exists lease_fence bigint not null default 0,
  add column if not exists attempt integer not null default 1;

create index if not exists agent_kit_runs_lease_idx
  on public.agent_kit_runs(state, lease_until);

create or replace function public.agent_kit_claim_run(
  p_run_id uuid,
  p_owner text,
  p_now timestamptz,
  p_lease_until timestamptz
) returns public.agent_kit_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.agent_kit_runs%rowtype;
begin
  update public.agent_kit_runs
  set state = 'running',
      lease_owner = p_owner,
      lease_fence = lease_fence + 1,
      attempt = attempt + 1,
      lease_until = p_lease_until,
      heartbeat_at = p_now,
      updated_at = now()
  where id = p_run_id
    and (
      state in ('queued', 'waiting_input', 'waiting_takeover')
      or (state = 'running' and (lease_until is null or lease_until <= p_now))
    )
  returning * into v_run;

  return v_run;
end;
$$;

revoke all on function public.agent_kit_claim_run(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.agent_kit_claim_run(uuid, text, timestamptz, timestamptz) to service_role;

-- `p_owner`/`p_fence` hanno un default perche` i deploy di questo repo NON eseguono le
-- migration: fra l'applicazione di questa e il deploy del codice che passa il lease c'e` una
-- finestra in cui la produzione chiama ancora la vecchia firma a cinque argomenti. Con il
-- default quella chiamata risolve qui e continua a funzionare senza recinto; col lease il
-- recinto c'e`. La migration che rende i due parametri obbligatori arriva DOPO il deploy.
create or replace function public.agent_kit_close_run(
  p_run_id uuid,
  p_to_state text,
  p_reason text default null,
  p_question jsonb default null,
  p_message jsonb default null,
  p_owner text default null,
  p_fence bigint default null
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
    and (p_owner is null or (lease_owner = p_owner and lease_fence = p_fence))
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

-- La firma a cinque argomenti della 0228 se ne va: la nuova accetta esattamente quegli stessi
-- cinque nomi, quindi la chiamata del codice deployato continua a risolvere. Tenerle entrambe
-- la renderebbe ambigua ("function is not unique") e romperebbe ogni chiusura.
drop function if exists public.agent_kit_close_run(uuid, text, text, jsonb, jsonb);

revoke all on function public.agent_kit_close_run(uuid, text, text, jsonb, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function public.agent_kit_close_run(uuid, text, text, jsonb, jsonb, text, bigint) to service_role;
