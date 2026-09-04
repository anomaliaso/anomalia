# Le letture di billing guardano l'org, non più il brand

L'abbonamento appartiene all'organizzazione e copre tutti i suoi brand (mappa #183). Restavano
tredici punti che leggevano `stripe_customer_id`/`stripe_subscription_id`/`plan` da `brands`: le
cinque azioni di `settings-actions.ts` che chiamano Stripe, e otto letture di sola
visualizzazione (il contesto degli agenti, `hasBilling` nei settings, il tool
`get_subscription`).

`src/lib/server/org-billing.ts` risponde a una domanda sola — **con quale customer e quale
subscription paga questo brand** — org-first, con fallback sul brand. Il fallback è sul brand
**che porta la subscription**, non su quello che il chiamante ha in mano: durante il rollout
org-per-org (#185) le colonne del brand restano popolate, ma il brand in mano può essere un
fratello free di un'org che paga, e chiedere a lui significa rispondere "qui non c'è
fatturazione" a un'organizzazione che sta pagando. È il caso che il fallback ingenuo sbaglia, ed
è coperto da un test.

**Il difetto che il repointing meccanico avrebbe introdotto**: `deleteBrand` cancellava la
subscription ogni volta che il brand ne aveva una. Con l'abbonamento sull'org, cancellare un
brand di tre avrebbe spento la fatturazione anche per gli altri due. Ora la subscription se ne va
solo con l'ultimo brand dell'org (`brandCount <= 1`).

Per il contesto degli agenti la strada è diversa: `system-prompt.ts` riceve un brand già letto e
non ha un client Supabase in mano. Invece di far risalire una risoluzione fino a lì, le quattro
select che lo alimentano incorporano `organizations(plan, stripe_customer_id,
stripe_subscription_id)` e il prompt legge org-first. Per un ospite (`brand_members` senza
appartenenza all'org) la RLS non restituisce l'org: il `??` cade sul brand e risponde come prima.

**Scartato:** riusare `resolveOrgBilling()` di `credits.ts` (PR #210). Fa le stesse due letture ma
vive su un branch non ancora in `dev`, e restituisce quota/periodo, non gli id di Stripe. Basare
questa PR su quel branch avrebbe legato due merge già dipendenti da #202. Quando entrambe sono su
`dev` le due funzioni vanno unite: stessa lettura, campi diversi.

**Scartato:** una migrazione dei dati per popolare in anticipo le colonne dell'org. È il lavoro
di #191, org per org, con la sua verifica — non un effetto collaterale di una PR di codice.
