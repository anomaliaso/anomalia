# La lista delle rotte nominava una rotta cancellata

`agent-lab` è stato eliminato con la #245, ma `workbench-paths.ts` continuava a elencarlo fra le
rotte escluse dalla modal. `page-modal-tiers.test.ts` confronta quella lista con le rotte che
esistono davvero sul disco, quindi è diventato rosso **su `dev`** — e con lui la CI di ogni PR
aperta, che a quel punto sembrava rotta per colpa propria.

Il test faceva esattamente il suo mestiere: è la ragione per cui esiste. Qui si toglie la riga.

## E due rimandi scaduti

`billing/contract.ts` e `billing/contract.test.ts` spiegavano il proprio meccanismo per analogia
con `agent-lab/shell.test.ts`, un file che non c'è più. Un commento che rimanda a qualcosa di
cancellato è peggio di nessun commento: manda a cercare una cosa che non si trova. Entrambi
descrivono adesso quello che fanno senza appoggiarsi a un esempio esterno.
