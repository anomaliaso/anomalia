# La timeline della ricerca è un registro, non un log

`StrategyStep.svelte` disegna la timeline con `{#each researchSteps as s (s.step)}`: la chiave è il
nome dello step. Un tentativo ripreso ereditava gli step già guadagnati (#109) e poi annunciava
quello da cui riparte, quindi `steps.push` aggiungeva un secondo `editorialPlan`. Svelte lancia
`each_key_duplicate` e smonta l'intero step: il piano atterrava dietro uno spinner che non se ne
andava più.

Un job reale sullo stack locale lo portava quattro volte, uno per tentativo:

```
["handles","scraping","benchmark","analysis","strategy","editorialPlan","editorialPlan","editorialPlan","editorialPlan"]
```

Il secondo è già fatale — e da quando #109 rende la ripresa la strada normale, lo è anche il crash.

`putStep` fa l'upsert: uno step che esiste resta al suo posto e tiene il `result` che si era già
guadagnato, cambia solo il messaggio. Le righe scritte prima esistono ancora e ucciderebbero il
wizard lo stesso, quindi `applyResearchResult` ripiega i duplicati anche in lettura.

Scartato: **togliere la chiave dall'`{#each}`**. Nasconde il duplicato invece di impedirlo, e la
chiave serve — le righe della timeline si aprono e si chiudono, l'identità conta.

Scartato: **deduplicare solo nel client.** La regola sarebbe finita in due posti che divergono al
primo cambiamento. Chi produce la timeline è il server: l'invariante sta lì, e il client si
difende solo dalle righe già scritte.
