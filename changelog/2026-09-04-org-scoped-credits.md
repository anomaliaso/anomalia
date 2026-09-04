# I crediti diventano il pool dell'organizzazione, non del singolo brand

Il passo B della migrazione billing (mappa #183). Lo schema esiste già in #202: qui il codice
comincia a leggerlo. `getCreditsUsage` e `gateCreditsCore` risolvono da soli l'org partendo dal
brandId, così **nessuno dei 29 punti di gate cambia firma** — continuano a passare un brand, e la
risposta arriva dal pool che quel brand condivide con gli altri della sua org.

Cosa cambia dentro: la spesa passa da `sum_brand_ai_cost_usd` a `sum_org_ai_cost_usd` (somma i
brand dell'org), i grant sommano sia quelli intestati all'org sia quelli dei suoi brand, la quota
viene da `organizations.plan`, il periodo da `org_billing_period`, e la cache a 60s del gate è
chiavata sull'org: cinque brand della stessa org fanno una lettura sola invece di cinque copie
degli stessi numeri.

**Il punto che decide se questa PR è mergiabile o no: funziona in entrambi gli stati del
rollout.** Il rollout è org-per-org (#185) e finché non finisce la maggioranza delle org ha le
colonne vuote, mentre i loro brand hanno ancora tutto. Quindi ogni lettura è org-first con
fallback sul brand che porta la subscription — non sul brand che il chiamante ha in mano, che può
essere un altro. È la differenza che conta: leggendo un brand free di un'org che paga tramite un
suo fratello, la risposta giusta è la quota pagata, non `FREE_CREDITS`. Il test che pinna questo
caso è quello che fallisce per primo se qualcuno "semplifica" il fallback.

`sumActiveCreditGrants` cambia firma (prende l'`OrgBilling` invece del brandId): è esportata ma
la chiamava solo `credits.ts`.

**Scartato: risolvere l'org nei 29 chiamanti.** Sarebbe stato esplicito, ma 29 firme cambiate
sono 29 occasioni di dimenticarne una, e chi dimentica ottiene silenziosamente il pool sbagliato.
Risolvendo al centro, l'unico modo di sbagliare è non chiamare affatto il gate.

**Scartato: una seconda cache per la risoluzione org.** C'è già `stripePeriodByBrand` con lo
stesso TTL di 5 minuti per la stessa ragione; le nuove mappe la seguono invece di inventare un
meccanismo diverso.

**Nota sul fail-open.** `gateCreditsCore` risolve l'org dentro un try/catch che ricade in
fail-open, ma il controllo di cache e l'`assertCreditsAvailable` finale stanno **fuori** da quel
catch: un diniego per crediti esauriti è il gate che fa il suo lavoro, e se finisse dentro il
catch verrebbe scambiato per un errore di lettura e lascerebbe passare. È lo stesso silenzio che
in produzione ha tenuto il gating spento per una settimana.
