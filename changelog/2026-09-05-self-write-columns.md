# Una policy vincola la riga, non la colonna — e fra quelle colonne c'era il piano

Tre tabelle avevano la stessa forma: una policy che dice «puoi scrivere solo la tua roba», e nessuna
che dica **quali campi** della tua roba puoi decidere. `profiles self update` con
`with check (id = auth.uid())`, `org owner all` e `brands via org` con `ALL` e il vincolo
sull'appartenenza. Tutte e tre vere e tutte e tre insufficienti, perché fra le colonne della propria
riga ce n'erano che decidono un diritto invece di descrivere un dato.

## Cosa apriva, misurato

**`profiles.approved_at`** è quello che legge `is_approved()`, che è quello che legge `can_enter()`,
cioè il cancello della beta chiusa. `PATCH /rest/v1/profiles?id=eq.<sé> {"approved_at": "…"}`
rispondeva 200 e l'utente si approvava da solo.

Va detto con la sua misura, che non è quella di un incendio: in produzione `app_flags` ha
`closed_beta = false`, quindi `can_enter()` risponde sì a chiunque e la scalata **oggi non apre
niente**. È una mina, e il giorno in cui qualcuno riaccende il flag — l'unico gesto per cui il
cancello esiste — il cancello è già scavalcabile e nessuno lo segnala.

**`organizations.plan`** non è latente. `resolveOrgBilling` (credits.ts:205) restituisce
`org.plan ?? paying?.plan`: la colonna vince per prima e non viene mai confrontata con Stripe.
`creditQuota` (credits.ts:42) è una lettura in una mappa, e la mappa dice 400 crediti per il piano
vuoto, 11.250 per `pro`. `PATCH /rest/v1/organizations?id=eq.<la propria> {"plan":"pro"}` valeva
**28 volte la quota, gratis**. `stripe_subscription_id`, `activated_at`, `brands.plan` e
`brands.status` erano scrivibili dalla stessa policy, e una policy `ALL` lascia anche NASCERE la
riga già `pro`: `insert into brands (…, plan)` passa il `with check`, che guarda `org_id`.

## Il confine che mancava non era fra clienti

Quello regge: la RLS lo tiene, su tutte le tabelle. Il confine assente era fra **ciò che un utente
possiede** e **ciò che un utente può decidere di sé** — e non somiglia a un'intrusione, perché è il
proprietario che modifica il proprio oggetto. È il motivo per cui un red team che attacca il confine
fra tenant non lo trova.

## Il grant per colonna, non un trigger

Il livello che sa distinguere le colonne è il GRANT: Postgres non ha un `with check` per colonna.
Fra le due strade si è presa quella dichiarativa perché la regola resta leggibile senza aprire il
codice — `information_schema.column_privileges` la racconta in una query — mentre un trigger sarebbe
codice da ritrovare e una condizione in più da ricordare a ogni colonna nuova. E il default cade nel
verso giusto: una colonna nuova nasce **non** scrivibile, e il percorso che ne ha bisogno si rompe
subito e a voce alta invece di restare aperto in silenzio.

L'elenco sta in **un posto solo** per tutte e tre le tabelle
(`20260905210000_self_write_columns.sql`). Tre registri in tre file divergono al primo cambiamento,
e divergono senza dirlo.

## Due colonne sono passate al service role, e non sono soldi

`brands.stripe_customer_id` e `brands.zernio_profile_id` erano scritte col client dell'utente
(`ensureBrandCustomer`, `ensureBrandProfile`). Non sono soldi di per sé, ma scriverci il valore di un
ALTRO cliente ne eredita la capacità: il trigger della 0007 aggancia la sottoscrizione proprio per
`stripe_customer_id` (`where b.stripe_customer_id = NEW.customer`), e `zernio_profile_id` è il
profilo con cui si pubblica sui social collegati. Le due funzioni ora scrivono con la chiave di
servizio: l'utente le fa nascere, non le sceglie.

## Il grant non era la difesa: quattro `SECURITY DEFINER` senza controllo nel corpo

`brand_provider_spend_usd`, `agent_kit_claim_run`, `agent_kit_close_run`,
`agent_kit_wait_for_approval` non guardano né `auth.uid()`, né `auth.role()`, né
`auth_brand_ids()`. In produzione reggono perché `anon` e `authenticated` non hanno `execute` —
verificato, otto combinazioni su otto false. **Sullo stack self-hosted locale, stesse migration,
otto su otto vere**: `proacl` mostra `=X/…`, cioè PUBLIC con `execute`, su tutte e quattro. Un
`revoke` in una migration è un evento, non uno stato: il record in `app_schema_migrations` dice che
il file è passato, non che il suo effetto è ancora lì, e `db:migrate` non ripasserà mai su quel file.

Quindi il filtro va **dentro il corpo**, che è la forma già scelta in
`20260905120000_secdef_least_privilege.sql`. Due forme, perché le funzioni non si somigliano:

- `brand_provider_spend_usd` prende un `brand_id`, quindi il tenant è nell'argomento: il filtro è
  quello che la sorella `sum_brand_ai_cost_usd` (0164) ha già.
- Le tre `agent_kit_*` prendono un `run_id`. Non si risale al tenant perché non serve: l'unico
  chiamante a runtime è la service role (`run-store.ts` riceve il client, e i soli percorsi che lo
  costruiscono sono in `scripts/eval/durability.ts` con `createAdminClient()`; `runTurn` non ha
  chiamanti fuori dai suoi test, e in `src/` non c'è una chiamata a queste tre RPC). Il controllo è
  `if auth.role() <> 'service_role' then raise`, la forma che `append_thread_event` ha già.

Onestà su `agent_kit_wait_for_approval`: oggi una chiamata estranea non depositava niente comunque,
ma **per caso** — l'insert in `agent_kit_approval_requests` finisce in `append_thread_event`, che
alza, e l'intera chiamata torna indietro. L'`update … set state = 'waiting_takeover'` in cima
partiva lo stesso, e il giorno in cui `thread_id` diventasse opzionale resterebbe scoperto.

## Il test che si rompe da solo

Vitest mocka Supabase: un update finto accetta qualunque cosa, quindi policy, grant e corpi di
SECURITY DEFINER lì non si misurano. `scripts/privilege-harness.mjs` (`npm run test:privileges`) è
il gemello di `constraint-harness.mjs`: scrive davvero contro un Postgres locale, dentro una
transazione chiusa da `rollback`, con `set local role authenticated` e le claim del JWT.

Tre proprietà, e la terza è quella che vale nel tempo:

1. la scalata deve essere **rifiutata** (42501 sulle colonne, P0001 dentro le funzioni);
2. il percorso legittimo deve **continuare a funzionare** — nome, lingua, avatar, fuso,
   piattaforme, e il service role che prende, mette in attesa e chiude un run;
3. **ogni colonna delle tre tabelle deve essere classificata** nel registro. Una colonna nuova non
   classificata rende rosso l'harness e la nomina — provato aggiungendo `organizations.can_publish`
   dentro la transazione: `FAIL … non classificate: can_publish`.

Le SECURITY DEFINER si provano col grant **rimesso** dentro la transazione, di proposito: la domanda
non è «authenticated può eseguirla?» — quella la decide un grant, e un grant torna — ma «se la
eseguisse, cosa otterrebbe?».

Rosso prima: 4/14. Verde dopo l'aggiunta delle tabelle e delle asserzioni: 29/29.

## Niente changelog pubblico

Per chi usa il prodotto non cambia niente: nome, lingua, avatar, impostazioni del brand si salvano
come prima, e l'unica differenza è per chi stava scavalcando. Annunciarla darebbe istruzioni, non
notizie.

## Quello che resta aperto, e dove ho guardato

Tutte le 78 policy di scrittura dello schema sono per riga, nessuna per colonna. La grande
maggioranza sono tabelle di contenuto per brand, dove ogni colonna descrive un dato. Quelle in cui
una colonna somiglia a un diritto, e che NON sono in questa PR:

- **`brand_usage.posts_count` / `videos_count`** — i contatori dei tetti mensili del piano, scritti
  sotto una policy `ALL` per brand. Non sono i crediti (quelli si contano da `ai_calls`), ma un
  utente che li azzera si rialza i tetti di post e video.
- **`api_keys.permissions`** — `api_keys self manage`. Una chiave non può superare i diritti del suo
  proprietario (`cli-auth` ricontrolla la proprietà del brand), quindi non è una scalata; resta una
  colonna che descrive un permesso sotto una policy che guarda la riga.
- **`shared_views.token_hash` / `expires_at` / `revoked_at`** — l'autore può già creare e revocare
  le proprie viste, ma può anche far tornare viva una vista revocata riscrivendo `revoked_at`.
