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

Il battito sta ora in `live-run-poll.svelte.ts`, e la pagina gli passa una copia NON reattiva del
run (`liveRunRef`, tenuta allineata da un effetto separato e a costo zero). È la copia che rompe
il cappio: `orphanRun` resta ciò che la pagina disegna, e nessun effetto che possiede un intervallo
dipende più da ciò che la risposta del poll riscrive. Dopo il fix, stesso scenario: 10 poll in 10
secondi e il testo che continua a crescere in pagina dopo il ricaricamento.

### `untrack` non bastava, e per poco non se ne accorgeva nessuno

Il primo tentativo avvolgeva le letture in `untrack` e sembrava funzionare: nel browser i numeri
crollavano. Misurato nel test, `untrack` NON impedisce il re-run in questa forma — un effetto che
legge un `$state` tramite una port `() => run` si invalida lo stesso, con o senza. Il fix
funzionava per un'altra ragione, non per quella scritta nel commento. Una copia semplice, invece,
non è un segnale: non c'è niente a cui iscriversi.

La sonda che lo dice, tenuta corta:

    nothing=1  direct=2  untrackPort=2  untrackArrow=2  inAsyncFn=1

### Il seam c'era, mancava una riga di config

`$effect` esiste solo nella build client di Svelte, e `exports.default` del pacchetto punta a
`index-server.js`, dove è un no-op: in ambiente node il corpo dell'effetto non gira e un test lì
passa identico col fix e senza. Non è un limite della suite, è la condizione di risoluzione —
`environmentMatchGlobs: [['**/*.svelte.test.ts', 'jsdom']]` la sistema, e jsdom era già installato.

Una seconda trappola sopra: dentro `$effect.root` gli effetti si svuotano su microtask, quindi
`flushSync()` da solo conta zero. Ci vuole `await tick()`.

Il test ora c'è ed è stato visto rosso ricollegando la port allo stato reattivo:
`expected 2 to be 1`.
