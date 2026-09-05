-- IL REGISTRO DI CHI DECIDE COSA. Sta qui, per tutte e tre le tabelle, e da nessun'altra parte.
--
-- Una policy RLS vincola la RIGA, non la COLONNA. `profiles self update` dice
-- `using (id = auth.uid()) with check (id = auth.uid())`; `org owner all` e `brands via org` dicono
-- la stessa cosa per ALL. Letto di corsa sembra completo — «puoi scrivere solo la tua roba» — ed è
-- vero e insufficiente, perché fra le colonne della propria roba ce ne sono che **decidono un
-- diritto** invece di descrivere un dato, e un `with check` non ha niente da dire su QUALE colonna
-- stai scrivendo.
--
-- Cosa apre, misurato e non supposto:
--
--   `PATCH /rest/v1/profiles?id=eq.<sé> {"approved_at":"…"}` → 200. `approved_at` è ciò che legge
--   `is_approved()`, che è ciò che legge `can_enter()`, cioè il cancello della beta chiusa. Oggi in
--   produzione `app_flags.closed_beta = false`, quindi la scalata non apre niente: è una mina, non
--   un incendio. Il giorno in cui il flag si riaccende — l'unico gesto per cui il cancello esiste —
--   è già scavalcabile da chiunque abbia un account, e niente lo segnala.
--
--   `PATCH /rest/v1/organizations?id=eq.<la propria> {"plan":"pro"}` → 200, e questo NON è latente.
--   `resolveOrgBilling` (credits.ts:205) restituisce `org.plan ?? paying?.plan`:
--   `organizations.plan` vince per primo e non viene mai confrontato con Stripe. `creditQuota`
--   (credits.ts:42) è una lettura in una mappa, e la mappa dice 400 crediti per il piano vuoto e
--   11.250 per `pro` (plans.ts). Ventotto volte la quota, senza toccare Stripe.
--
--   E una policy `ALL` lascia anche NASCERE la riga già `pro`: `insert into brands (…, plan)` passa
--   il `with check`, che guarda `org_id`, non `plan`.
--
-- Il confine che mancava non è quello fra clienti — quello regge, la RLS lo tiene. È quello fra ciò
-- che un utente **possiede** e ciò che un utente **può decidere di sé**, e non somiglia a
-- un'intrusione: è il proprietario che modifica il proprio oggetto.
--
-- ── Perché il grant per colonna, e non un trigger ────────────────────────────────────────────
--
-- Il livello che sa distinguere le colonne è il GRANT. Fra le due strade si prende questa perché la
-- regola resta LEGGIBILE senza aprire il codice:
--
--   select table_name, column_name, privilege_type from information_schema.column_privileges
--   where grantee = 'authenticated' and table_name in ('profiles', 'organizations', 'brands');
--
-- Un trigger sarebbe codice che il prossimo deve prima trovare, e una condizione in più da
-- ricordare a ogni colonna nuova. Qui l'elenco È la regola, e il default cade nel verso giusto: una
-- colonna nuova nasce non scrivibile, e il percorso che ne ha bisogno si rompe subito e a voce alta
-- invece di restare aperto in silenzio.
--
-- `npm run test:privileges` (`scripts/privilege-harness.mjs`) tiene lo specchio di questo elenco e
-- diventa rosso in tre casi: una colonna nuova non classificata, un grant più largo di quanto è
-- dichiarato qui, un tentativo di scalata che riesce.
--
-- Niente di tutto questo tocca il service role: `/admin/users` approva, il trigger
-- `sync_brand_from_stripe_subscription` (0007) scrive `plan`/`status`/`activated_at`, i cron
-- scrivono i loro cursori. E dentro una SECURITY DEFINER il `current_user` è il proprietario della
-- funzione, non `authenticated`: `accept_brand_invite` continua a scrivere l'`approved_at` di chi
-- accetta un invito, e `handle_new_user` a creare il profilo con la sua email.

-- ── profiles ────────────────────────────────────────────────────────────────────────────────
--
-- Decide l'utente: `full_name` (settings-actions.updateProfile), `avatar_url` (carica e rimuovi la
-- foto), `locale` (`+layout.server.ts` alla prima visita, `POST /api/v1/locale`).
--
-- Decide il sistema: `approved_at` (il cancello), `email` (la scrive solo `handle_new_user`,
-- copiandola da `auth.users`), `id`, `utm`, `created_at`.
--
-- `email` non decide nessun accesso, ed è stato cercato prima di dirlo: `is_admin()` e
-- `accept_brand_invite` confrontano con l'email del JWT, `is_user_approved` con quella di
-- `auth.users`, e nessuno cerca un profilo PER email — chi la legge la usa come indirizzo a cui
-- spedire o come stringa da mostrare. Resta fuori lo stesso, per una ragione che non è la scalata:
-- `/admin/users` la mostra alla persona che approva, e un indirizzo riscritto dall'utente le mente.
--
-- L'INSERT non ha una policy, quindi la RLS lo rifiuta già; il grant si toglie perché l'elenco resti
-- vero a colpo d'occhio, non perché apra qualcosa.

revoke insert, update on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, locale) on public.profiles to authenticated;

-- ── organizations ───────────────────────────────────────────────────────────────────────────
--
-- Decide l'utente: solo la nascita del proprio workspace (`ensureOrgForUser`, org.ts:51), con
-- `name` e `owner_id` — e `owner_id` la policy lo inchioda già a `auth.uid()`.
--
-- Decide il sistema: `plan`, `activated_at`, `stripe_customer_id`, `stripe_subscription_id`. Sono
-- il piano e la sua prova, e li scrive Stripe attraverso il service role.
--
-- Nessun UPDATE: in tutto il repository non c'è un percorso che aggiorni `organizations` col client
-- dell'utente. Il giorno che si vorrà rinominare un workspace dall'interfaccia si aggiunge qui
-- `grant update (name)`, e il test lo pretende.

revoke insert, update on public.organizations from anon, authenticated;
grant insert (name, owner_id) on public.organizations to authenticated;

-- ── brands ──────────────────────────────────────────────────────────────────────────────────
--
-- Decide l'utente, alla nascita: `id` (l'onboarding conia l'uuid nel browser, brand-create.ts),
-- `org_id`, `slug`, `created_by`, più i campi che il wizard raccoglie.
--
-- Decide l'utente, dopo: le impostazioni e il contenuto — nome, sito, fuso, piattaforme,
-- preferenze, annunci, modello della chat — più i segnaposto del percorso di setup (`setup_step`,
-- `onboarding_state`, `launched_at`) e il cursore dell'import storico (`own_history_at`, che il
-- load di /analytics scrive col client dell'utente).
--
-- Decide il sistema, e sono i soldi: `plan`, `status`, `activated_at`, `trial_ends_at`,
-- `paused_at`, `stripe_subscription_id`. Li scrive il trigger della 0007 leggendo
-- `stripe.subscriptions`.
--
-- Decide il sistema, e sono chiavi di identità esterna: `stripe_customer_id` e `zernio_profile_id`.
-- Non sono soldi di per sé, ma scriverci il valore di un ALTRO cliente ne eredita la capacità: il
-- trigger della 0007 aggancia la sottoscrizione proprio per `stripe_customer_id`
-- (`where b.stripe_customer_id = NEW.customer`), e `zernio_profile_id` è il profilo con cui si
-- pubblica sui social collegati. Le due funzioni che li coniano — `ensureBrandCustomer`,
-- `ensureBrandProfile` — passano alla chiave di servizio nello stesso commit: l'utente le fa
-- nascere, non le sceglie.
--
-- Decide il sistema, e sono cursori di cron: `last_rank_check_at`, `last_crawl_at`,
-- `last_review_at`, `last_visual_at`, `last_digest_sent_at`, `last_autopilot_run_at`,
-- `autopilot_failure_count`, `blog_slug`, `blog_config` — tutti scritti con `createAdminClient()`.
-- E `autopilot_enabled`, che è ritirato (job-roster.ts): nessuno lo scrive più.
--
-- La DELETE resta intera: `settings-actions.deleteBrand` cancella il brand col client dell'utente, e
-- una riga si cancella o no — non per colonne.

revoke insert, update on public.brands from anon, authenticated;
grant insert (
  id, org_id, created_by, name, website, slug, target_platforms, content_prefs,
  onboarding_completed_at
) on public.brands to authenticated;
grant update (
  name, website, timezone, target_platforms, content_prefs, ads_settings, chat_default_tier,
  launched_at, setup_step, setup_completed_at, onboarding_state, onboarding_completed_at,
  own_history_at
) on public.brands to authenticated;
