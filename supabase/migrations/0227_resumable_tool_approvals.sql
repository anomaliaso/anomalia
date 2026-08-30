alter table public.agent_kit_runs
  add column if not exists harness_continue_state jsonb;

create table if not exists public.agent_kit_approval_requests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  run_id uuid not null references public.agent_kit_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  harness_approval_id text not null,
  tool_call_id text not null,
  tool_name text not null,
  tool_input jsonb not null,
  input_hash text not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired', 'cancelled', 'consumed')),
  decided_by uuid references auth.users(id) on delete set null,
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, harness_approval_id)
);

create index if not exists idx_agent_kit_approvals_thread
  on public.agent_kit_approval_requests(thread_id, status, created_at desc);

alter table public.agent_kit_approval_requests enable row level security;

drop policy if exists agent_kit_approvals_select on public.agent_kit_approval_requests;
create policy agent_kit_approvals_select on public.agent_kit_approval_requests for select
  using (
    user_id = auth.uid()
    and brand_id in (select public.auth_brand_ids())
  );

revoke all on public.agent_kit_approval_requests from anon, authenticated;
grant select on public.agent_kit_approval_requests to authenticated;

create or replace function public.agent_kit_wait_for_approval(
  p_run_id uuid,
  p_harness_approval_id text,
  p_tool_call_id text,
  p_tool_name text,
  p_tool_input jsonb,
  p_input_hash text,
  p_reason text,
  p_continue_state jsonb,
  p_message jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.agent_kit_runs%rowtype;
  v_approval public.agent_kit_approval_requests%rowtype;
  v_message public.chat_messages%rowtype;
  v_message_payload jsonb;
begin
  update public.agent_kit_runs
  set state = 'waiting_takeover',
      harness_continue_state = p_continue_state,
      question = null,
      updated_at = now()
  where id = p_run_id and state = 'running'
  returning * into v_run;

  if v_run.id is null then
    return jsonb_build_object('closed', false);
  end if;

  insert into public.agent_kit_approval_requests (
    brand_id, thread_id, run_id, user_id, harness_approval_id,
    tool_call_id, tool_name, tool_input, input_hash, reason
  ) values (
    v_run.brand_id, v_run.thread_id, v_run.id, v_run.user_id, p_harness_approval_id,
    p_tool_call_id, p_tool_name, p_tool_input, p_input_hash, p_reason
  )
  returning * into v_approval;

  if p_message is not null then
    v_message_payload := p_message;
    if jsonb_typeof(p_message->'tool_calls') = 'array' then
      v_message_payload := jsonb_set(
        v_message_payload,
        '{tool_calls}',
        (
          select coalesce(
            jsonb_agg(
              case
                when part->>'type' = 'tool-approval-request'
                  and part->>'approvalId' = p_harness_approval_id
                then part || jsonb_build_object('approvalId', v_approval.id::text)
                else part
              end
              order by item.ord
            ),
            '[]'::jsonb
          )
          from jsonb_array_elements(p_message->'tool_calls') with ordinality as item(part, ord)
        )
      );
    end if;

    insert into public.chat_messages (brand_id, user_id, thread_id, role, content, reasoning, tool_calls, attachments, name)
    values (
      v_run.brand_id,
      v_run.user_id,
      v_run.thread_id,
      'assistant',
      coalesce(v_message_payload->>'content', ''),
      v_message_payload->>'reasoning',
      v_message_payload->'tool_calls',
      v_message_payload->'attachments',
      v_message_payload->>'name'
    )
    returning * into v_message;

    update public.agent_kit_runs
    set partial_saved_msg_id = v_message.id
    where id = p_run_id;
  end if;

  if v_run.thread_id is not null then
    perform public.append_thread_event(
      v_run.thread_id,
      'run:' || p_run_id || ':state:waiting_takeover',
      'progress',
      jsonb_build_object(
        'runId', p_run_id,
        'status', 'waiting_takeover',
        'approvalId', v_approval.id
      )
    );
  end if;

  return jsonb_build_object(
    'closed', true,
    'approval_id', v_approval.id,
    'harness_approval_id', v_approval.harness_approval_id,
    'message_id', v_message.id
  );
end;
$$;

create or replace function public.decide_agent_kit_approval(
  p_approval_id uuid,
  p_status text,
  p_reason text default null
) returns public.agent_kit_approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval public.agent_kit_approval_requests%rowtype;
  v_status text;
begin
  if p_status not in ('approved', 'denied') then
    raise exception 'approval status is not supported';
  end if;

  select a.* into v_approval
  from public.agent_kit_approval_requests a
  where a.id = p_approval_id
    and a.user_id = auth.uid()
    and a.brand_id in (select public.auth_brand_ids())
  for update;

  if v_approval.id is null then
    raise exception 'approval not found';
  end if;

  if v_approval.status <> 'pending' then
    if v_approval.status = p_status then
      return v_approval;
    end if;
    raise exception 'approval already decided';
  end if;

  update public.agent_kit_approval_requests
  set status = p_status,
      decided_by = auth.uid(),
      decision_reason = p_reason,
      decided_at = now(),
      updated_at = now()
  where id = p_approval_id and status = 'pending'
  returning * into v_approval;

  return v_approval;
end;
$$;

revoke all on function public.agent_kit_wait_for_approval(uuid, text, text, text, jsonb, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agent_kit_wait_for_approval(uuid, text, text, text, jsonb, text, text, jsonb, jsonb) to service_role;

revoke all on function public.decide_agent_kit_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_agent_kit_approval(uuid, text, text) to authenticated;
