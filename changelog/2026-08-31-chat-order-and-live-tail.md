# Due difetti della chat, dallo stesso paio di merge

Segnalati insieme, causati da due cose diverse. Entrambi riprodotti dal vivo sullo stack
locale prima di toccare una riga.

## 1. La conversazione usciva capovolta

`chronologicalTail(newestFirst, limit)` fa `slice(0, limit).reverse()`: **pretende** una lista
ordinata dal più recente, perché la query che la alimenta è `order('created_at', desc)`. Da
`f569f32` (approvazioni durevoli) la stessa funzione riceve la proiezione del log degli eventi,
che esce in ordine di `seq` — cioè dal più VECCHIO. Il risultato non era «ogni tanto disordinato»:
era la conversazione intera al contrario, la risposta sopra la domanda a cui rispondeva, più i
100 messaggi più vecchi al posto dei 100 più recenti.

Nessun test lo copriva: quel ramo era stato aggiunto senza uno, e il ramo di fallback — che
riceve davvero una lista `desc` — restava corretto, quindi la suite non aveva niente da dire.
Ora c'è `newestTail`, che è la coda di una lista già cronologica, e `thread-ui-order.test.ts`
guarda entrambe le letture.

## 2. Ricaricare a metà turno congelava la pagina

`$effect` che segue il run vivo leggeva `orphanRun` dentro `poll()` — chiamata in modo sincrono
alla fine del corpo, quindi lettura TRACCIATA — e la risposta del poll lo riscriveva. Ogni
risposta invalidava l'effetto, che si smontava (interval cancellato) e si rimontava chiamando
subito `poll()`. Non è un poll ogni 350ms: sono **3378 giri misurati in 10 secondi**, ~840 al
secondo, con il thread principale saturo. Da fuori: la chat resta «attiva», il contatore non si
muove, non arriva più né testo né tool né pensiero.

Il battito sta ora in `live-run-poll.svelte.ts` e le letture del run passano da `untrack`: il
ritmo lo detta l'intervallo, non il grafo di reattività. Dopo il fix, stesso scenario: 17 poll in
11 secondi, `orphanState.reasoning` a 17k caratteri, il piano editoriale che continua a scriversi
in pagina dopo il ricaricamento.

### Il test che NON c'è, e perché

Il cappio reattivo non è verificabile in questa suite: gli effetti Svelte non vengono eseguiti
nell'ambiente di test attuale (una sonda `$effect.root` + `flushSync` conta zero esecuzioni del
corpo). Un test che passa identico con e senza il fix è peggio di nessun test, quindi è stato
tolto invece che lasciato a fare da guardia finta. Restano i due test sul ritmo, che si reggono
senza scheduler. Il seam manca davvero: sta in [`LESSONS.md`](../LESSONS.md).
