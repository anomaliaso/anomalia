# Le quattro rotte che pianificano passano dal cancello

`propose`, `revise`, `replan-week` e `weekly-plan/plan` arrivano tutte a un modello —
`proposePlan`, `revisePlan`, `replanWeek`, `planWeekStrategy` — e nessuna delle quattro chiamava
`gateAiAction`. Sono le etichette più care che abbiamo: negli ultimi sette giorni `reviewCaptions`
$13,54, `planStrategy` $11,50, `reviewSeeds` $8,10. Il saldo crediti non le fermava, e la
restrizione di scrittura di una chiave API non le raggiungeva dalla rotta (la raggiunge da
`authenticate`, che dal 2026-08 nega ogni non-GET a una chiave di sola lettura: il cancello per
rotta è la seconda linea, quella che regge se domani qualcuno cambia idea sul metodo).

Il cancello sta subito dopo `loadBrandForUser`, prima di leggere il corpo: crediti finiti è 402
prima di «feedback is required», non dopo. I quattro contratti dichiarano `credits_exhausted`,
perché `statusForFailure` degrada a 500 un 402 non dichiarato — che si legge come «guasto nostro»
invece che «crediti finiti».

## Cosa NON è stato toccato, e perché

**`/ads` non chiama nessun modello.** Era nella lista delle cinque rotte che spendono senza
cancello: non lo è. `ads.ts`, `ads-fatigue.ts` e `zernio-ads.ts` non importano niente che parli a
un modello — `proposeBoosts` è ranking e insert, `proposeStandalone` prende la creatività dal
corpo. La POST ha già `checkApiKeyWriteAccess`, e l'unica azione che spende davvero (`approve`, la
fee di gestione) controlla già il saldo con `canAffordAdsCredits`. La proposta di ads con l'AI
vive in `/ads/remix`, che il cancello ce l'ha da sempre. Mettere `gateAiAction` qui avrebbe
addebitato un controllo crediti a un'operazione gratuita.

Resta un difetto vicino, non chiuso qui: `approve` risponde `credits_exhausted:<servono>:<restano>`
con **400**, e il contratto non lo dichiara affatto. Stringa dinamica, quindi non entra nella lista
`failures` così com'è: va deciso se normalizzarla a 402 + campi, ed è un cambio di forma della
risposta su una rotta viva.

**L'esenzione onboarding non esiste.** `gateCreditsCore` chiama `isCreditExempt()` e esce subito,
ma `withCreditExempt` — l'unica cosa che può accenderla — non ha **nessun** call site in tutto il
repository. `isCreditExempt()` in produzione risponde sempre falso. Quindi aggiungere il cancello
non poteva spegnere l'onboarding per quella strada; e l'onboarding non passa comunque da queste
rotte, che sono la superficie CLI/MCP: la prima proposta di piano la fanno
`app/[brand]/plan/+page.server.ts` e `app/[brand]/editorial/+page.server.ts`, la prima settimana
`app/[brand]/setup/+server.ts`, tutti e tre chiamando le funzioni direttamente. Quelle strade
restano senza cancello proprio, e questo è un buco vero che questa PR non tocca: toccare il
percorso di iscrizione è caro da sbagliare e merita il suo diff.
