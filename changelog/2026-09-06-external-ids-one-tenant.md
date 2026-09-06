# Un identificatore esterno appartiene a un solo tenant

La 20260905210000 ha chiuso `brands.stripe_customer_id` e `brands.zernio_profile_id` col grant per
colonna. La classe però non finiva lì: la stessa forma — **un id che punta a un sistema esterno,
scrivibile dall'utente e poi usato dal server con una credenziale che vale per tutti i clienti** —
vive in altre quattro colonne, e in due code di lavoro.

## Perché il grant per colonna qui non bastava

Il registro dei grant separa `authenticated` dal `service_role`. Ma `upsertBrandConnection`,
`upsertSource`, `syncBrandAccounts` e `syncBrandTriggers` ricevono tutti il `supabase` di `locals`,
cioè la chiave anon più il JWT: **il ruolo che attacca è il ruolo con cui gira l'app**. Togliere il
grant avrebbe spento la connessione insieme all'attacco.

Il confine che mancava non è fra ruoli, è che lo stesso identificatore esterno poteva stare in due
righe di due brand diversi. Da qui l'indice unico: dice un fatto di dominio — un account connesso
nasce sotto un solo `user_id` Composio (`brand_<uuid>`), un account Zernio sotto un solo profilo, e
un profilo è di un brand — e nessuna riga legittima lo viola. La riga costruita per attaccare
collide con quella della vittima, che esiste per definizione: se non esiste, non c'è niente da
rubare.

Cosa apriva, cercato nel codice:

- `brand_app_connections.connected_account_id` → `deleteConnectedAccount` (`composio.ts:328`) manda
  a Composio `revoke` + `DELETE` con l'id e basta, nessuno scope. Disconnettere l'integrazione di
  un altro.
- `brand_knowledge_sources.connected_account_id` → `composioProxy` (`provider-fetch.ts:37`) manda
  **solo** `connected_account_id`. Leggere il Drive o il Notion di un altro brand.
- `brand_triggers.trigger_instance_id` → `deleteTriggerInstance` (`brand-triggers.ts:139`).
- `social_accounts.zernio_account_id` → `publish.ts:367` lo passa a Zernio come `accountId`.

Nessuno di questi è indovinabile: sono id opachi. Il modello di minaccia realistico non è la forza
bruta, è **chi l'id l'ha letto legittimamente** — un membro di un brand condiviso, che la SELECT
serviva, e che poi è stato tolto dal brand.

## Le due chiavi di una riga di coda

`webhook_deliveries` e `chat_jobs` portano due riferimenti al tenant che viaggiano separati, e il
`with check` ne guarda uno solo.

Su `webhook_deliveries` la policy `for all` della 0194 non serviva a nessuno: le uniche scritture
sono `enqueueDelivery` e `attemptDelivery`, e le chiamano l'ingress di Composio e il cron, tutte e
due con `createAdminClient()`. Il grant apriva una consegna su ordinazione (payload, endpoint e
istante scelti dall'utente) e, con `webhook_id` di un altro brand, la firma di quel brand sul suo
endpoint. `revoke insert, update`, e nessun grant di ritorno.

Su `chat_jobs` la policy confronta col chiamante `brand_id` e `user_id`, non `thread_id`. Il drain
gira col service role e usava le due chiavi come se fossero coerenti: una riga con la coppia
sbagliata avrebbe fatto lavorare il turno su un brand e scrivere su un thread di un altro. Il
controllo sta dentro `processNextQueuedChatJob`, dove le due chiavi si incontrano — non nei
chiamanti, che sono tanti e divergerebbero al primo cambiamento.

## L'endpoint si rivalida dove si chiama, e con la guardia che risolve il nome

`validateWebhookUrl` guardava le due rotte che salvano l'endpoint. La riga però è scrivibile dal
browser (anon key + JWT, `for all` sul proprio brand), quindi **l'URL che il worker chiamava non era
l'URL che una rotta aveva validato**: bastava un `PATCH` su PostgREST per farci fare una POST verso
la rete che sceglieva l'utente. Il controllo adesso sta in `attemptDelivery`, cioè dentro la
funzione che usa il valore, e copre entrambe le strade (ingress e retry) con un controllo solo.

E **non è `validateWebhookUrl`**: quella confronta il testo dell'host contro delle espressioni
regolari, e un nome pubblico il cui record DNS risponde `127.0.0.1` la passa. Il rebinding è
precisamente ciò che può cambiare **dopo** che la riga è stata salvata, cioè l'unica cosa che un
controllo al salvataggio non poteva vedere per costruzione: spostare il momento e tenere il
confronto a pattern avrebbe lasciato la guardia cieca proprio verso ciò che quel momento serve a
vedere. Si usa `assertPublicUrl` (`tool-guard.ts:237`), che risolve il nome e guarda gli indirizzi
veri, in `https-only`. Stessa funzione che la #388 fa usare al salvataggio: due momenti, una
guardia sola.

La consegna inoltre non segue più i redirect (`redirect: 'error'`). Un host consentito che risponde
`302` scavalcherebbe il controllo — è la metà del difetto che LESSONS.md già nomina — e su una POST
con corpo non c'è modo economico di rigiocare la guardia a ogni salto: rifiutarsi di seguirli è
l'equivalente onesto.

## Cosa resta fuori, e perché

`zernio_ad_accounts.zernio_ad_account_id` e `.zernio_social_account_id` hanno la stessa forma —
`launchCampaign` li passa a Zernio per creare annunci che qualcuno paga — ma **l'unicità non è un
fatto di dominio lì**: l'upsert è su `(brand_id, zernio_ad_account_id)` di proposito, e un'agenzia
può far girare due brand sullo stesso account pubblicitario. Un unico globale romperebbe un caso
vero. La difesa giusta è il controllo al punto d'uso contro la lista che Zernio dà per il profilo
del brand; oggi gli ads sono dietro `FEATURE_ADS` più il piano (`adsAvailable`), quindi è una mina,
non un incendio, e va chiusa con la sua PR.

`agent_kit_runs` e `onboarding_jobs` erano nella pista e **non reggono**: sul primo `authenticated`
ha solo la SELECT (0216), il secondo è ritirato e nessuno lo scrive più.

## Ordine di applicazione

Questa migration si somma alla 20260905210000 e non la sostituisce: non ridichiara niente di ciò
che quella fa, e tocca tabelle diverse. La 20260905210000 è già applicata alla produzione, quindi
questa si applica da sola.

`npm run test:privileges` tiene lo specchio di entrambe: l'harness applica le migration dentro la
transazione, quindi si guarda fallire prima e passare dopo.
