-- Una `security definer` gira coi privilegi del proprietario, e il proprietario qui è `postgres`,
-- che ha `rolbypassrls = true`: dentro la funzione la RLS non esiste. Quindi `execute` ad
-- `authenticated` non è un dettaglio di comodo — è la porta. PostgREST espone ogni funzione dello
-- schema esposto che il ruolo può eseguire, quindi ogni grant di troppo è un endpoint pubblico.
--
-- Il criterio, uno solo: `authenticated` tiene `execute` SOLO se il chiamante legittimo è codice
-- client con la sessione dell'utente. Un trigger no — dentro il trigger il ruolo corrente è già
-- il definer, quindi il grant a `postgres` basta e quello ad `authenticated` è superficie e basta.

-- ── 1. Chiamate solo da trigger: nessuno che scrive ha bisogno di `execute` ──────────────────
--
-- `notify_admin_email` manda una email con oggetto e HTML ARBITRARI a andrea@ e marco@, firmata
-- noreply@anomalia.so, con la chiave Resend presa dal Vault, e ingoia ogni errore (`when others
-- then null`): nessuna traccia, nessun limite di frequenza. I soli chiamanti sono i due trigger di
-- 0083 (`tg_notify_new_user`, `tg_notify_new_brand`), che essendo `security definer` di `postgres`
-- la chiamano col grant di `postgres`. Era eseguibile anche da `anon`, cioè dalla chiave pubblica
-- che sta nel bundle JS.
revoke execute on function public.notify_admin_email(text, text) from public, anon, authenticated;

-- `append_thread_message_revision` non controlla NIENTE: non guarda `user_id` del thread né
-- `auth_brand_ids()`, quindi con un thread_id e un message_id sostituisce il messaggio di un altro
-- cliente e cancella le revisioni precedenti. Il confronto che lo inchioda è `append_thread_event`,
-- la funzione gemella scritta bene, che ha `if v_thread.user_id <> auth.uid() then raise`. L'unico
-- chiamante è il trigger `capture_chat_message_revision` (20260901150000).
revoke execute on function public.append_thread_message_revision(uuid, uuid, jsonb) from public, anon, authenticated;

-- ── 2. Nessun chiamante, in tutto il repository ──────────────────────────────────────────────
--
-- `waitlist_position` dice quanti profili si sono iscritti prima di te: un numero di business che
-- non serve a nessuno qui dentro. Zero occorrenze in `src/`, `cli/`, `scripts/`, `packages/`.
revoke execute on function public.waitlist_position() from public, anon, authenticated;

-- `decide_agent_kit_approval` è scritta bene — filtra su `auth.uid()` E `auth_brand_ids()`, quindi
-- non è una falla — ma non la chiama nessuno: zero occorrenze nel repository, e in produzione
-- `agent_kit_approval_requests` ha zero righe. Finché la UI delle approvazioni non esiste, il
-- grant non ha un chiamante che lo giustifichi. Quando arriverà, si riaccende con una riga:
--   grant execute on function public.decide_agent_kit_approval(uuid, text, text) to authenticated;
revoke execute on function public.decide_agent_kit_approval(uuid, text, text) from public, anon, authenticated;

-- ── 3. Funzioni trigger: il grant non apre niente, ma non significa niente ───────────────────
--
-- Restituiscono `trigger`, e PostgREST non le mette in cache (404 PGRST202, verificato). Il grant
-- è rumore che fa sembrare aperta una porta murata: si toglie perché l'elenco resti leggibile.
revoke execute on function public._cleanup_demo_account_secret() from public, anon, authenticated;
revoke execute on function public._cleanup_integration_secret() from public, anon, authenticated;
revoke execute on function public.chat_job_state_broadcast() from public, anon, authenticated;
revoke execute on function public.sync_brand_from_stripe_subscription() from public, anon, authenticated;
revoke execute on function public.tg_notify_new_brand() from public, anon, authenticated;
revoke execute on function public.tg_notify_new_user() from public, anon, authenticated;

-- `rls_auto_enable` restituisce `event_trigger`: Postgres rifiuta la chiamata diretta con 0A000
-- ("trigger functions can only be called as triggers"). È un presidio, non un buco — accende la
-- RLS su ogni tabella nuova di `public` — e non è in nessuna migrazione: vive solo in produzione.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- ── 4. Il grant serve, il controllo dentro no: si aggiunge il controllo, non si toglie il grant ──
--
-- Questi tre girano col client dell'utente (`hooks.server.ts` e `cli-auth.ts` costruiscono un
-- client a chiave anon col JWT: il ruolo è `authenticated`), quindi togliere il grant spegnerebbe
-- l'assemblaggio del prompt in silenzio — i chiamanti fanno solo `console.error`. Quello che manca
-- è il filtro sul proprietario, che `bump_disruptive_idea_shown` ha già e queste due no.

revoke execute on function public.bump_brand_memory_usage(uuid[]) from public, anon;
create or replace function public.bump_brand_memory_usage(entry_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.brand_memory m
  set times_used = times_used + 1,
      last_used_at = now()
  where m.id = any (entry_ids)
    and (
      auth.role() = 'service_role'
      or m.brand_id in (select public.auth_brand_ids())
    );
$$;
grant execute on function public.bump_brand_memory_usage(uuid[]) to authenticated, service_role;

revoke execute on function public.bump_brand_media_usage(uuid, uuid[]) from public, anon;
create or replace function public.bump_brand_media_usage(p_brand_id uuid, media_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.brand_media
  set times_used = times_used + 1,
      last_used_at = now()
  where brand_id = p_brand_id
    and id = any (media_ids)
    and (
      auth.role() = 'service_role'
      or p_brand_id in (select public.auth_brand_ids())
    );
$$;
grant execute on function public.bump_brand_media_usage(uuid, uuid[]) to authenticated, service_role;

-- Già protetta dentro: qui cade solo `anon`, che non ha mai una chat da cui pescare idee.
revoke execute on function public.bump_disruptive_idea_shown(uuid[], uuid) from public, anon;
grant execute on function public.bump_disruptive_idea_shown(uuid[], uuid) to authenticated, service_role;

-- ── 5. Il periodo di fatturazione di chiunque, senza sessione ────────────────────────────────
--
-- Queste due leggono `stripe.subscriptions` — uno schema che `authenticated` non può nemmeno
-- toccare direttamente ("permission denied for schema stripe") — e non controllano chi chiede.
-- Con l'uuid di un brand altrui restituiscono le sue date di fatturazione, e il grant era a
-- `public`: bastava la chiave anon. Il filtro è quello che `sum_brand_ai_cost_usd` ha già.
-- `authenticated` resta perché `credits.ts` le chiama sul percorso di pagina, col client dell'utente.

revoke execute on function public.brand_billing_period(uuid) from public, anon;
create or replace function public.brand_billing_period(_brand_id uuid)
returns table (period_start timestamptz, period_end timestamptz)
language sql stable security definer set search_path = public, stripe as $$
  select
    to_timestamp(coalesce((s.items->'data'->0->>'current_period_start')::bigint, s.current_period_start, s.billing_cycle_anchor)),
    to_timestamp(coalesce((s.items->'data'->0->>'current_period_end')::bigint, s.current_period_end))
  from public.brands b
  join stripe.subscriptions s on s.id = b.stripe_subscription_id
  where b.id = _brand_id
    and s.status in ('active', 'trialing')
    and (
      auth.role() = 'service_role'
      or b.id in (select public.auth_brand_ids())
    )
  limit 1;
$$;
grant execute on function public.brand_billing_period(uuid) to authenticated, service_role;

-- L'organizzazione si vede anche da chi non la possiede ma lavora su un suo brand: `auth_org_ids()`
-- da solo elencherebbe le sole org possedute, e un membro invitato perderebbe il periodo.
revoke execute on function public.org_billing_period(uuid) from public, anon;
create or replace function public.org_billing_period(_org_id uuid)
returns table (period_start timestamptz, period_end timestamptz)
language sql stable security definer set search_path = public, stripe as $$
  select
    to_timestamp(coalesce((s.items->'data'->0->>'current_period_start')::bigint, s.current_period_start, s.billing_cycle_anchor)),
    to_timestamp(coalesce((s.items->'data'->0->>'current_period_end')::bigint, s.current_period_end))
  from public.organizations o
  join stripe.subscriptions s on s.id = o.stripe_subscription_id
  where o.id = _org_id
    and s.status in ('active', 'trialing')
    and (
      auth.role() = 'service_role'
      or o.id in (select public.auth_org_ids())
      or exists (
        select 1 from public.brands b
        where b.org_id = o.id and b.id in (select public.auth_brand_ids())
      )
    )
  limit 1;
$$;
grant execute on function public.org_billing_period(uuid) to authenticated, service_role;

-- ── Restano com'erano, e il motivo ───────────────────────────────────────────────────────────
--
-- `auth_brand_ids` (citata in 207 policy), `auth_org_ids`, `member_brand_ids`, `owner_brand_ids`,
-- `is_admin`, `is_approved`, `can_enter`, `flag_enabled`: una policy si valuta coi privilegi di chi
-- interroga, quindi `authenticated` deve poterle eseguire o la RLS smette di valutarsi.
--
-- `sum_brand_ai_cost_usd`, `sum_org_ai_cost_usd`: hanno già il filtro sul proprietario.
-- `accept_brand_invite`: confronta il token con l'email del JWT, e `+page.server.ts:158` la chiama
-- con `locals.supabase` — la sessione dell'utente. Revocarla rompe gli inviti.
--
-- `bump_*` e `*_billing_period` tengono `authenticated` per una ragione misurata, non per prudenza:
-- gli stessi percorsi girano con DUE client. Sincrono, col client dell'utente:
-- `routes/app/[brand]/motion-video/+server.ts:98` e `routes/app/[brand]/plan/+page.server.ts:67`
-- passano `locals.supabase`. In coda, con la service role: `chat/queue.ts:1489` costruisce
-- `createAdminClient()` e lo porta negli stessi `createChatTools` / `remaining`. Togliere il grant
-- spegnerebbe metà dei percorsi in silenzio — i chiamanti fanno `console.error` e vanno avanti.
--
-- `append_thread_event` NON è qui di proposito: oggi non ha nessun chiamante a runtime (solo la sua
-- definizione), ma ha già dentro `if v_thread.user_id <> auth.uid() then raise`, cioè è stata
-- scritta per essere chiamata dalla sessione dell'utente, e fa parte del lavoro sugli eventi
-- durevoli ancora in corso (0226). Revocarla adesso spegnerebbe una cosa che sta per atterrare.
