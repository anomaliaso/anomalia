# Due link di pagamento che un agente esterno può mintare

Richiesta del proprietario, alla lettera: «un endpoint per creare un nuovo checkout e uno per
aprire il portale Stripe dell'utente, così anche gli agenti possono avviarli e ripassarli
all'utente». Quella frase è anche il confine di sicurezza, e vive nel codice: **l'agente non paga
e non cambia mai un piano.** Ottiene una URL e la restituisce; l'umano la apre e completa
l'azione sulla pagina ospitata da Stripe.

`POST /api/v1/brands/:slug/billing/portal` e `POST /api/v1/brands/:slug/billing/checkout`, quindi
i tool MCP `create_billing_portal_link` e `create_checkout_link`, che nascono da soli dal registry
dei contratti.

## Cosa è stato riusato, e cosa è stato estratto

`createBillingPortalSession` esisteva già e non è stata toccata. Quello che **non** esisteva è un
posto da cui chiamarla: la logica stava inline dentro due page action di
`settings-actions.ts` (`billingPortal` e `upgrade`), ciascuna con la propria risoluzione dell'org,
la propria chiamata a Stripe e il proprio `throw redirect(303, url)`. Il redirect è il
comportamento del **form web**, non della funzione — un endpoint API vuole la stessa risposta
senza il redirect.

Primo commit, separato e a comportamento invariato: `src/lib/server/billing-links.ts` con
`billingLink()`, che risponde o con una URL o con **una** delle quattro ragioni per cui non può
mintarla. Le due action mappano quelle ragioni sui redirect e sui messaggi che già producevano.
Unica differenza, irraggiungibile dalla UI: `billingPortal` con `flow=upgrade` e nessun
abbonamento ora rifiuta invece di aprire in silenzio la home del portale — nessun form posta quel
flow, solo `invoices` e `payment_method`.

**Non è stata scritta una seconda integrazione Stripe, e nessun price id è stato introdotto.** Il
checkout è la stessa pagina ospitata che il bottone di upgrade del prodotto apre oggi
(`flow_data.subscription_update`): il listino sta su Stripe, e `src/lib/server/stripe.ts` dichiara
apposta che l'app non nomina mai un prezzo. Il repo non contiene alcuna creazione di Checkout
Session — non c'è, non è stata inventata. Un'org che non si è mai abbonata riceve `no_customer` /
`no_subscription` (409) con `app_billing_url`: la pagina in-app da cui la persona parte davvero.

## Org contro brand: dove sono finiti gli endpoint

Il registry dei contratti è scoped sul brand (`/api/v1/brands/:slug/…`), la fatturazione
appartiene all'organizzazione. Le due strade erano: stare nel registry e risolvere l'org lato
server, oppure uscirne e mettere gli endpoint altrove.

Sono **dentro** il registry. Ragioni, in ordine: lo slug è l'unica maniglia che un agente ha in
mano — ogni comando CLI/MCP è brand-scoped; l'org si risolve con `orgBillingForBrand`, la stessa
funzione che legge `/app/billing`, quindi resta **un solo posto** che decide quale org fattura un
brand; e il metodo CLI e il tool MCP nascono da soli dal registry, mentre fuori andrebbero
scritti a mano. Il test di guardia del registry non è stato toccato né indebolito.

## Chi è autorizzato

Raggiungere un brand non è avere autorità sui soldi dell'org. Sul web la guardia è
`isBrandOwner`, che si appoggia alla RLS; qui la RLS non prova niente, perché il path con API key
gira come service role e vedrebbe qualunque brand. Quindi `isOrgOwner(supabase, orgId, userId)`,
scritta accanto al modello che governa (org-billing.ts) e con il confronto esplicito su
`owner_id`: vale per entrambi i path di autenticazione. Un collaboratore di un brand condiviso
(0077) prende `not_org_owner` (403), come il browser gli direbbe «Owner only».

## Niente gate sui crediti, mai

Nessuno dei due chiama `gateAiAction` e nessuno guarda i crediti. Sarebbe circolare: chi ha finito
i crediti è precisamente la persona che deve arrivare al checkout. Due test lo tengono fermo, e
un terzo verifica che nessuna delle scritture Stripe (`applyRetentionCoupon`,
`cancelSubscriptionAtPeriodEnd`, `ensureSubscriptionCanceled`) sia raggiungibile da qui.

Una API key **read-only** viene comunque rifiutata: il link porta anche a un bottone di disdetta.

## La URL è una capability al portatore

Una URL del portale dà accesso alla fatturazione di quel cliente a chiunque la possieda, senza
altra autenticazione. Non viene loggata, non viene salvata, compare una volta sola nel corpo
della risposta — e la descrizione che un modello esterno legge lo dice, insieme al fatto che da
quella pagina si può anche **disdire**. `destructiveHint` resta `false` (la chiamata non
distrugge niente) ma la descrizione non lascia credere che il link sia inerte.

## Status onesti

Un guasto di Stripe è **502**, non un 400 che accusa chi chiama — la stessa linea di #201.
`no_org_billing` è **500**: dopo che `loadBrandForUser` ha già provato che il brand esiste ed è
del chiamante, non poter risolvere la sua org è colpa nostra (succede, per esempio, quando due
righe trial condividono lo slug e la `maybeSingle()` di `orgBillingForBrand` fallisce).
`no_customer` e `no_subscription` sono **409**: la richiesta è corretta, lo stato dell'account
non c'è ancora.

## Quello che resta rotto (e non è di questa PR)

`node scripts/schema-drift-check.mjs` è **rosso su dev**: la migration
`20260903190000_org_billing_schema.sql` non è applicata in produzione — `organizations` ha cinque
colonne e non ha `plan`, `stripe_subscription_id`, `activated_at`; mancano anche
`credit_grants.org_id` e la tabella `org_usage`. `orgBillingForBrand` seleziona quelle colonne:
in produzione quella select fallisce, `data` torna null e la funzione risponde `null`. Significa
che oggi **anche il bottone del portale su `/app/billing` non funziona**, e che questi due
endpoint nascerebbero morti allo stesso modo. Non è un difetto introdotto qui e non si ripara con
del codice: la migration va applicata a mano, perché i deploy di questo repo non lo fanno.
