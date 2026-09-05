# Lo schema del billing sale di un livello, senza che nulla lo legga ancora

Primo passo della migrazione a "un abbonamento per organization, brand illimitati, pool crediti
condiviso" (mappa #183). Solo schema: nessun comportamento cambia finché il codice applicativo
non lo usa, e quello arriva nei passi successivi.

`organizations` guadagna `stripe_subscription_id`, `plan` e `activated_at` — stessi nomi e tipi
che hanno su `brands`, così ogni lettore a valle mantiene la stessa forma. `stripe_customer_id`
c'era già dalla 0001 e non l'aveva mai usato nessuno: ora è quello vero.

**Il trigger diventa org-first, brand-fallback.** `sync_brand_from_stripe_subscription()` cerca
prima un'organization con quel `stripe_customer_id`; se la trova scrive lì i campi di
fatturazione e propaga lo `status` a tutti i brand dell'org (un abbonamento, tutti i brand lo
seguono). Se non la trova, esegue l'update per-brand di prima, invariato. Non c'è un flag di
stato della migrazione: "org migrata" significa `organizations.stripe_customer_id` valorizzato.
I campi `stripe_*` e `plan` sui brand di un'org migrata restano **congelati** apposta — sono la
rete di sicurezza del rollout org-per-org, e cadranno in una migration finale unica.

Il `return NEW` dentro il ramo org non è cosmetico: senza, ogni webhook riscriverebbe anche le
colonne congelate del brand, cioè proprio la rete di rollback. È l'invariante che
`org-billing-schema.test.ts` pinna (verificata mutando la migration e guardando il test cadere).

`credit_grants` accetta ora un `org_id` con `brand_id` nullable e un CHECK che ne imponga
**esattamente uno**: un regalo va a un brand specifico (tracciabilità) o all'org intera. La
policy RLS filtrava sul solo `brand_id`, quindi un grant org-level sarebbe stato invisibile a chi
lo possiede — ora copre entrambi i casi.

Due RPC gemelle di quelle per-brand: `org_billing_period` (0089) e `sum_org_ai_cost_usd` (0164),
che somma la spesa di **tutti** i brand dell'org. Più `auth_org_ids()`, la metà org del choke
point RLS che `auth_brand_ids()` copre per i brand.

**Scartato: rinominare `brand_usage` in `org_usage`.** Il ticket la descriveva come la tabella
del timestamp anti-spam, ma `brand_usage` è in realtà il contatore delle quote **post e video**
per brand (`posts_count`, `videos_count`), letto da `usage.ts` e `cli-queries.ts` — e le quote
post restano un concetto per-brand. Spostarla avrebbe cambiato una semantica che nessuno ha
deciso di cambiare. Sale di livello solo il flag anti-spam dell'email all'80%, quindi ha una
tabella sua, piccola: `org_usage (org_id, month, credits_warned_at)`. I `credits_warned_at`
già presenti in `brand_usage` **non vengono migrati**: sono timestamp di email già spedite, e
ripartire puliti costa al massimo un avviso duplicato nel periodo corrente.

**Scartato: scrivere `organizations.activated_at` dall'onboarding.** Il ticket indicava
`onboarding/+page.server.ts:328` come il punto che scrive `brands.activated_at`: quella riga
scrive `editorial_plans.activated_at`. `brands.activated_at` non lo scrive nessun codice
applicativo — solo il trigger Stripe. Quindi anche la versione org la scrive il trigger, con la
stessa identica condizione (prima attivazione, mai più). Per un'org free resta `null` e
`credits.ts` ricade sull'inizio del mese solare, esattamente come fa oggi per un brand free.

**Scartato: il backfill di `activated_at` dai brand esistenti.** Popolare le colonne delle org
già esistenti è il passo D (migrazione dati), non questo.
