-- 0215 — nessuna traccia è più pubblica della conversazione che trascrive.
--
-- IL BUCO. `chat_threads` e `chat_messages` hanno `... and user_id = auth.uid()` nelle loro policy:
-- dentro lo stesso brand, la conversazione di un collega non si legge. `agent_sessions` no — la sua
-- unica policy è `brand_id in (select auth_brand_ids())` (0205). E il `transcript` di una sessione
-- CONTIENE i messaggi dell'utente. Quindi la traccia è più pubblica della cosa che trascrive: un
-- membro del brand legge le conversazioni degli altri passando dalla porta di servizio.
--
-- Il vincolo va sulla RIGA e non sulla colonna: gli stessi messaggi stanno sia in `transcript` sia
-- dentro `events`, e una policy per colonna li lascerebbe uscire dall'altra.
--
-- Le righe SENZA autore (cron, batch, job schedulati: `user_id is null`) restano leggibili, ma solo
-- al proprietario dell'organizzazione — non appartengono a nessuno e non possono sparire per tutti.
--
-- DA APPLICARE A MANO: i deploy di questo repo non eseguono le migration.

create or replace function public.owner_brand_ids() returns setof uuid
  language sql security definer set search_path = public stable as $$
  select b.id from public.brands b join public.organizations o on o.id = b.org_id
  where o.owner_id = auth.uid(); $$;

revoke execute on function public.owner_brand_ids() from public, anon;
grant execute on function public.owner_brand_ids() to authenticated;

drop policy if exists "agent_sessions readable by brand members" on public.agent_sessions;

create policy "agent_sessions readable by author or org owner" on public.agent_sessions
  for select using (
    brand_id in (select public.auth_brand_ids())
    and (user_id = auth.uid()
         or (user_id is null and brand_id in (select public.owner_brand_ids())))
  );
