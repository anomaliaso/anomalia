-- UN'IDENTITÀ ESTERNA APPARTIENE A UN SOLO TENANT. Il registro sta qui, per tutte le colonne che
-- indirizzano un sistema fuori da noi, e da nessun'altra parte.
--
-- La 20260905210000 ha chiuso `brands.stripe_customer_id` e `brands.zernio_profile_id` col grant
-- per colonna, ed è la strada giusta quando l'utente non deve scrivere quella colonna. Ma la stessa
-- forma vive in altre tabelle dove il grant NON separa niente, perché a scrivere quelle colonne è
-- il nostro stesso codice **col client dell'utente**: `upsertBrandConnection`, `upsertSource`,
-- `syncBrandAccounts`, `syncBrandTriggers` ricevono tutti il `supabase` di `locals`, cioè la chiave
-- anon più il JWT, cioè il ruolo `authenticated`. Togliere il grant spegnerebbe la connessione
-- insieme all'attacco.
--
-- Il confine che manca non è fra ruoli: è che **lo stesso identificatore esterno può stare in due
-- righe di due brand diversi**. La RLS guarda la riga, non il valore dentro la riga; e il valore, lì
-- dentro, è la chiave con cui il server parla a Composio e a Zernio con UNA credenziale che vale per
-- tutti i clienti. Chi conosce l'id di un altro — un ex membro di un brand condiviso lo ha letto
-- quando ci stava dentro, e la SELECT gliela dava — lo riscrive nella propria riga e il server lo
-- usa per lui.
--
-- Cosa apre, cercato nel codice e non supposto:
--
--   `brand_app_connections.connected_account_id` → `disconnectIntegration` (composio-catalog.ts:317)
--   lo passa a `deleteConnectedAccount`, che chiama `POST /connected_accounts/<id>/revoke` e poi
--   `DELETE`: nessun `user_id` nella richiesta, solo l'id. Disconnettere l'integrazione di un altro.
--   Lo stesso id finisce in `executeComposioTool` (composio-agent.ts:170), che almeno manda anche
--   `user_id` — se Composio verifichi la coppia non lo sappiamo, e una difesa che dipende da quello
--   che fa il fornitore non è una difesa.
--
--   `brand_knowledge_sources.connected_account_id` → `providerAuth` → `composioProxy`
--   (provider-fetch.ts:37), che manda SOLO `connected_account_id`. Leggere il Drive o il Notion di
--   un altro brand dentro la propria knowledge base.
--
--   `brand_triggers.trigger_instance_id` → `deleteTriggerInstance` (brand-triggers.ts:139), stesso
--   discorso: un id, nessuno scope.
--
--   `social_accounts.zernio_account_id` → `publish.ts:367` lo passa come `accountId` a Zernio.
--   Pubblicare sul profilo social di un altro brand.
--
-- ── Perché un indice unico, e non un grant né un trigger ─────────────────────────────────────
--
-- Il grant non morde: il ruolo che attacca è il ruolo che l'app usa (sopra). Un trigger sarebbe
-- codice da trovare, e una condizione da ricordare a ogni colonna nuova. L'indice unico dice invece
-- il fatto di dominio, per intero e in un posto solo: **un account connesso nasce sotto un unico
-- `user_id` Composio (`brand_<uuid>`), un account Zernio sotto un unico profilo, e un profilo è di
-- un brand**. Non c'è riga legittima che lo violi, e la riga costruita per attaccare collide con
-- quella della vittima — che esiste per definizione, altrimenti non c'è niente da rubare.
--
-- Si legge come si legge il registro dei grant, senza aprire il codice:
--
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and indexname like '%_one_tenant';
--
-- ── Cosa resta fuori, e perché ───────────────────────────────────────────────────────────────
--
--   `zernio_ad_accounts.zernio_ad_account_id` e `.zernio_social_account_id` hanno la stessa forma —
--   `launchCampaign` (ads.ts:694, 725) li passa a Zernio per creare annunci che qualcuno paga — ma
--   l'unicità NON è un fatto di dominio lì: l'upsert è su `(brand_id, zernio_ad_account_id)` di
--   proposito, e un'agenzia può far girare due brand sullo stesso account pubblicitario. Un unico
--   globale romperebbe un caso vero. La difesa giusta è il controllo al punto d'uso contro la lista
--   che Zernio dà per il profilo del brand, e non sta in questa migration. Oggi gli ads sono dietro
--   `FEATURE_ADS` più il piano (`adsAvailable`, ads.ts:61): è una mina, non un incendio.
--
--   `posts.external_post_id`, `market_posts.account_key`, `products.external_id` e simili sono
--   identificatori esterni scrivibili, ma non aprono niente di un altro tenant: chi li legge li usa
--   dentro una query già filtrata per brand, oppure li manda a un fornitore che risponde con dati
--   pubblici. Cercati uno per uno prima di lasciarli qui.
--
-- ── Prima di applicare ───────────────────────────────────────────────────────────────────────
--
-- Un duplicato preesistente fa fallire la creazione dell'indice, ed è giusto così: se esiste, è già
-- una riga da guardare. Si trova prima con:
--
--   select 'brand_app_connections', connected_account_id, count(*) from public.brand_app_connections
--     group by 2 having count(*) > 1
--   union all select 'brand_knowledge_sources', connected_account_id, count(*)
--     from public.brand_knowledge_sources group by 2 having count(*) > 1
--   union all select 'brand_triggers', trigger_instance_id, count(*)
--     from public.brand_triggers group by 2 having count(*) > 1
--   union all select 'social_accounts', zernio_account_id, count(*)
--     from public.social_accounts group by 2 having count(*) > 1;

create unique index if not exists brand_app_connections_account_one_tenant
  on public.brand_app_connections (connected_account_id);

create unique index if not exists brand_knowledge_sources_account_one_tenant
  on public.brand_knowledge_sources (connected_account_id);

create unique index if not exists brand_triggers_instance_one_tenant
  on public.brand_triggers (trigger_instance_id);

create unique index if not exists social_accounts_zernio_one_tenant
  on public.social_accounts (zernio_account_id);

-- ── webhook_deliveries: la coda non si scrive dal browser ────────────────────────────────────
--
-- La 0194 le ha dato una policy `for all` sul proprio brand, e nessuno se ne è servito: le uniche
-- scritture sono `enqueueDelivery` e `attemptDelivery`, e le chiamano l'ingress di Composio e il
-- cron, tutte e due con `createAdminClient()` (composio/webhook/+server.ts:60, webhooks/work). Chi
-- legge il log è la GET del brand, col client dell'utente, e la SELECT resta.
--
-- Il grant apriva due cose. La prima: `payload`, `next_attempt_at` e `status` scrivibili sono una
-- consegna su ordinazione — l'utente si fa spedire dal nostro server un corpo che sceglie lui, verso
-- l'URL che ha scritto nella propria riga `brand_webhooks`. La seconda: `brand_id` e `webhook_id`
-- sono due riferimenti al tenant INDIPENDENTI, e il `with check` guarda solo il primo. Una riga con
-- il proprio `brand_id` e il `webhook_id` di un altro fa firmare al worker un evento inventato col
-- segreto della vittima, verso il suo endpoint. Il worker adesso confronta la coppia
-- (`claimDueDeliveries`), ma la riga non deve proprio poter nascere.
--
-- Nessun `grant` di ritorno: qui non c'è una colonna che l'utente decida di sé. Se un giorno servirà
-- (un "rimanda questa consegna" dall'interfaccia), si aggiunge la colonna qui e il test lo pretende.

revoke insert, update on public.webhook_deliveries from anon, authenticated;
