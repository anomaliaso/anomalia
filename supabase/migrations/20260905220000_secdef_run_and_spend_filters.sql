-- Il grant non è una difesa: è una porta che qualcuno può riaprire.
--
-- `20260905120000_secdef_least_privilege.sql` ha già fatto questo lavoro per le funzioni sorelle,
-- e il criterio è lì. Queste quattro erano rimaste fuori, e sono il caso che il criterio serve a
-- coprire: SECURITY DEFINER di un proprietario con `rolbypassrls`, e nel corpo NESSUN controllo —
-- né `auth.uid()`, né `auth.role()`, né `auth_brand_ids()`. Reggono soltanto perché `anon` e
-- `authenticated` non hanno `execute`.
--
-- In produzione oggi non ce l'hanno: verificato con `has_function_privilege`, otto combinazioni su
-- otto false. Quindi NON sono buchi aperti, e questa migration non ripara un incendio. Ripara la
-- dipendenza da una condizione che non è nostra: su uno stack costruito con gli strumenti di
-- questo repository le stesse otto combinazioni sono TUTTE vere (`npm run test:privileges` lo
-- misura, e lo ha misurato). Basta un grant di troppo — una dashboard, un ripristino, uno
-- strumento che ricrea la funzione e le rimette i grant di default — e da
-- `brand_provider_spend_usd` esce la spesa per fornitore di un tenant qualunque con la sola chiave
-- pubblica, e dalle `agent_kit_*` esce una SCRITTURA cross-tenant su un run di cui si conosca
-- l'uuid. Col filtro dentro, la funzione regge anche se il grant torna.
--
-- Due forme, perché le funzioni non si somigliano.
--
-- `brand_provider_spend_usd` prende un `brand_id`, quindi il tenant è nell'argomento: il filtro è
-- quello che la sorella `sum_brand_ai_cost_usd` (0164) ha già, copiato senza inventare niente.
-- `authenticated` non riprende `execute`: l'unico chiamante è `rank-tracker.ts`, che gira in un
-- cron con `createAdminClient()`.
--
-- Le tre `agent_kit_*` prendono un `run_id`, non un brand — e non si risale al tenant, perché non
-- serve: l'unico chiamante a runtime è la service role. `run-store.ts` le chiama con il `db` che
-- riceve, e i soli percorsi che lo costruiscono sono `scripts/eval/durability.ts` con
-- `createAdminClient()`; `runTurn` non ha chiamanti fuori dai suoi test, e in `src/` non c'è una
-- sola chiamata a queste tre RPC. Aggiungere `or <brand> in (select auth_brand_ids())` sarebbe
-- complessità pagata per un chiamante che non esiste: quando arriverà, la riga si aggiunge.
--
-- La forma del controllo è quella di `append_thread_event`, che ce l'ha già:
-- `if auth.role() <> 'service_role' then raise`. Con `auth.role()` nullo — una connessione diretta
-- a Postgres, cioè qualcuno che possiede già tutto — il confronto è nullo e non alza: identico al
-- gemello, e nessuna manutenzione dal vivo cambia comportamento.
--
-- Nota su `agent_kit_wait_for_approval`, perché il rapporto non la racconti peggio di com'è: oggi
-- una chiamata estranea non deposita niente comunque, ma per caso — l'`insert` in
-- `agent_kit_approval_requests` finisce in `append_thread_event`, che alza, e l'intera chiamata
-- torna indietro. Il `update ... set state = 'waiting_takeover'` in cima parte lo stesso, e il
-- giorno in cui `thread_id` diventa opzionale o quel controllo si sposta, resta scoperto.

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
  if auth.role() <> 'service_role' then
    raise exception 'agent_kit_claim_run: solo il service role';
  end if;

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
  if auth.role() <> 'service_role' then
    raise exception 'agent_kit_close_run: solo il service role';
  end if;

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

revoke all on function public.agent_kit_close_run(uuid, text, text, bigint, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agent_kit_close_run(uuid, text, text, bigint, text, jsonb, jsonb) to service_role;

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
  if auth.role() <> 'service_role' then
    raise exception 'agent_kit_wait_for_approval: solo il service role';
  end if;

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

revoke all on function public.agent_kit_wait_for_approval(uuid, text, text, text, jsonb, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agent_kit_wait_for_approval(uuid, text, text, text, jsonb, text, text, jsonb, jsonb) to service_role;

create or replace function public.brand_provider_spend_usd(
  p_brand_id uuid,
  p_provider text,
  p_since timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)::numeric
  from public.ai_calls
  where brand_id = p_brand_id
    and provider = p_provider
    and created_at >= p_since
    and (
      auth.role() = 'service_role'
      or p_brand_id in (select public.auth_brand_ids())
    )
$$;

revoke all on function public.brand_provider_spend_usd(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.brand_provider_spend_usd(uuid, text, timestamptz) to service_role;
