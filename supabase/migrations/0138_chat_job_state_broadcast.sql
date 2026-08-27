-- Push chat turn state (running / done / failed / cancelled) onto the brand's Realtime channel,
-- so every tab and every client agrees on which conversations are working right now.
--
-- Why a trigger instead of calls in the app: a chat_response row is opened and closed from six
-- different places — the streaming route (onFinish / onError / onAbort), the queue worker, the
-- cancel action, and the stale-job reaper's cron. Six call sites is six chances to forget one, and
-- the one most worth catching is the reaper, which closes turns with no browser attached at all.
-- The database sees all six for free.
--
-- Narrow on purpose:
--   • only `chat_response` rows (async tool jobs have their own UI)
--   • only on INSERT and on an actual status CHANGE — `update of status` alone would still fire on
--     a no-op rewrite, and nothing must fire on the ~300ms `partial` stream mirror, which would
--     otherwise broadcast a few hundred times per turn
--
-- ⚠ Deploys in this project do NOT run migrations. Apply this by hand, after 0137.

create or replace function public.chat_job_state_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.thread_id is null or new.brand_id is null then
    return null;
  end if;

  -- A lost notification costs one client a stale dot until its next poll. Failing the UPDATE that
  -- carried it would cost a chat turn, so this can never be allowed to raise.
  begin
    perform realtime.send(
      jsonb_build_object(
        'threadId', new.thread_id,
        'jobId', new.id,
        'status', new.status
      ),
      'turn-state',
      'brand:' || new.brand_id::text,
      true
    );
  exception
    when others then
      null;
  end;

  return null;
end;
$$;

create trigger chat_jobs_state_insert
after insert on public.chat_jobs
for each row
when (new.tool_name = 'chat_response')
execute function public.chat_job_state_broadcast();

create trigger chat_jobs_state_update
after update of status on public.chat_jobs
for each row
when (new.tool_name = 'chat_response' and old.status is distinct from new.status)
execute function public.chat_job_state_broadcast();
