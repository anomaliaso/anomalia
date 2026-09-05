# Lo strumento per spostare la fatturazione sull'org, un'org alla volta

Il codice per la fatturazione a livello di organizzazione è tutto in `dev` (#202, #210, #212,
#216), ma nessuna org è ancora migrata: `organizations.stripe_customer_id` è vuoto ovunque, quindi
ogni lettura passa dal ramo di fallback verso il brand e per i clienti non è cambiato niente.
Questo è il ferro per fare il passaggio vero — il ticket #191.

`scripts/migrate-org-billing.ts` copia sull'org i valori Stripe del brand che paga:
`stripe_customer_id`, `stripe_subscription_id`, `plan`, `activated_at`. **Stripe non viene mai
chiamato**: l'org riusa lo stesso identico customer e la stessa identica subscription che il brand
ha già, che è ciò che rende il passaggio reversibile. Le colonne del brand non vengono toccate:
restano a rispondere finché una migration successiva non le rimuove (decisione #185).

**Dry-run per default.** Senza flag non scrive niente e stampa, org per org, cosa farebbe. `--apply`
**pretende** `--org <id>`: il rollout è una org alla volta con una verifica in mezzo (decisione
#192), e migrarne novanta con un comando non è una cosa che questo script sappia fare. `--verify`
ricontrolla i punti (a) e (b) della checklist — che org e brand pagante dicano gli stessi valori, e
che pool di crediti ne esca — e dichiara nell'output che (c) il portale che si apre e (d) l'azione
AI che passa il gate restano da fare a mano.

Chi paga si riconosce da **due** condizioni, `stripe_subscription_id` valorizzato **e** piano nella
lista dei paganti: la migration 0104 azzera il piano alla cancellazione lasciando l'id, quindi
nessuna delle due da sola distingue una subscription viva da una morta. È la stessa coppia di
condizioni che usa `payingOrgId` in `src/lib/server/org.ts`, non una terza definizione.

**Casi che si fermano invece di indovinare:** un'org con due brand paganti non viene migrata, viene
segnalata come conflitto e lo script esce con codice 1. Non dovrebbe esistere — nessun cliente ha
più di una subscription attiva — ma se esiste, quale delle due subscription diventa quella dell'org
è una domanda per una persona, non per uno script.

**`activated_at` viaggia con gli altri tre** anche se oggi non lo legge nessuno: un'org pagante
prende il periodo da Stripe, e finché le colonne del brand ci sono `resolveOrgBilling` ripiega
sulla data del brand pagante. È una colonna in più in un UPDATE che sta già avvenendo, ed è ciò che
impedisce all'ancora del piano free di spostarsi in silenzio sul mese solare il giorno in cui
quelle colonne spariranno.

**Scartato: collassare le org multiple dei fondatori.** Il testo di #191 lo chiedeva, ma è
antecedente alla decisione #203, che ha stabilito che il multi-org va preservato e che ogni org
resta indipendente. Lo script non collassa niente.

**Scartato: un guard "eseguito come comando" nello stesso file.** Sotto `vite-node` il path dello
script non arriva mai in `process.argv` (ci arrivano i flag, non il file), quindi il guard non può
funzionare — e senza guard un test che importa il modulo avvia un comando che sa scrivere su una
riga di fatturazione. La logica pura sta in `scripts/org-billing-plan.ts`, il comando la importa:
niente guard da azzeccare, e la parte che decide cosa viene scritto è testabile da sola.

**Quello che il primo dry-run vero ha trovato:** la migration `20260903190000_org_billing_schema.sql`
**non è applicata** in produzione. Lo script si è fermato su
`column organizations.stripe_subscription_id does not exist`, e `node scripts/schema-drift-check.mjs`
lo conferma con sette divergenze. Il codice in `dev` nomina già quelle colonne: finché la migration
non viene applicata a mano, in produzione la risoluzione dell'org fallisce e il gate dei crediti
ricade in fail-open — lo stesso silenzio di una settimana che #161 ha chiuso e che #205 rende
rumoroso.
