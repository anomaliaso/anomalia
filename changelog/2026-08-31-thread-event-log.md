# Il progress del turno diventa durevole, e il canale realtime smette di portare il contenuto

Il metro è la chat di [rakazo](https://github.com/elie222/rakazo), e il confronto
diceva due cose precise: da loro il canale live **non porta payload** (un `NOTIFY`
con dentro nient'altro che "qualcosa è cambiato", e il client rilegge da Postgres
per `seq > cursor`), e il testo in corso di scrittura è **durevole**, una sequenza
di eventi potati quando il messaggio definitivo li supera.

Da noi era il contrario: `kit_stream` spediva il chunk grezzo a ogni token, con
dentro `at: {text, reasoning}` — la posizione che il client doveva far combaciare
con la propria (`chat-live-join.ts`) prima di poter applicare il pezzo. Se non
combaciava, il chunk finiva in una coda da 1000 e aspettava che uno snapshot
assoluto pollato ogni 4s riempisse il buco. Tre sorgenti (chunk, `partial`,
ricarica) e tre regole di riconciliazione diverse.

## Cosa cambia

**Il riduttore tollera i buchi di sequenza.** Prima si fermava al primo `seq`
mancante: regola giusta quando gli eventi arrivavano *dentro* il push, sbagliata
adesso che l'autorità è la query. Con la lettura autorevole un buco significa
"qualcuno ha potato", non "ho perso un evento", e fermarsi lasciava la proiezione
indietro per sempre. Resta il conflitto su `source_key`, che è l'errore vero:
due payload diversi sotto la stessa chiave.

Senza questa rimozione la potatura è impossibile, ed è la potatura a tenere il log
finito.

**Il progress è un evento, non solo uno specchio.** `mirrorSseToRun` continua a
scrivere `agent_kit_runs.partial` — i lettori legacy sono ancora lì — ma ora
appende anche un evento `progress` con l'istantanea **assoluta** (`text`,
`reasoning`, `tools`) sotto la chiave `<runId>:progress:<tick>`: un rirunning dello
stesso tick torna la stessa riga invece di aggiungerne una.

Istantanea assoluta e non delta come rakazo: il `partial` che già costruiamo è
di quella forma, e il riduttore tiene solo l'ultima per `runId`. Un delta
risparmierebbe righe ma richiederebbe una fusione ordinata lato client, cioè
esattamente il tipo di riconciliazione che questo lavoro toglie di mezzo.

**Cadenza propria, 250ms.** Il `partial` si riscrive sulla stessa riga, l'evento
ne aggiunge una: alla cadenza dello specchio (100ms) sarebbe una riga ogni decimo
di secondo col testo intero dentro. L'ultima scrittura del turno resta
incondizionata (`'final'`), o un turno più corto della soglia non lascerebbe mai
l'istantanea completa.

**Le righe se ne vanno quando lo specchio ha finito di scriverle.** Il primo
tentativo potava accanto alla cancellazione del checkpoint, dove la riga
definitiva è appena andata a terra: sembra il posto giusto — è il momento in cui
il messaggio *supera* le istantanee — ed è sbagliato. Lo specchio è un ramo
concorrente al driver che chiude il run: una sua scrittura in volo passa davanti
alla potatura e lascia righe orfane che nessuno supererà più. Il test lo ha
mostrato subito.

`publishProgress` vive dentro `mirrorSseToRun`, quindi lo specchio è l'unico
scrittore di `progress` **e** l'ultimo: la potatura sta nel suo `finally`, dopo la
scrittura finale, ed è l'unico punto in cui non ne può più arrivare una. La
potatura nel percorso di chiusura è stata tolta: senza specchio non esistono
righe da potare, quindi non serviva a niente e apriva la finestra di orfani.

Non è la stessa transazione del messaggio, come fa rakazo: se il processo muore in
mezzo restano righe che il riduttore sovrascrive comunque per `runId`, ed è il
modo di sbagliare meno caro.

**Il poke.** `thread-seq` porta `{ threadId, seq }` e nient'altro. Una notifica
persa, doppia o fuori ordine costa una lettura, mai una trascrizione sfasata —
che è l'unica proprietà per cui vale la pena avere un canale realtime.

**La lettura per cursore.** `GET /app/<brand>/chat?thread=<id>&events_after=<seq>`
risponde al poke. Passa dal client dell'utente, quindi è la RLS di `thread_events`
a decidere cosa esce, non un controllo scritto a mano.

## Cosa NON cambia ancora

`kit_stream` e `kit_stream_done` continuano a partire, `chat-live-join.ts` e le
due `partial` sono al loro posto: il client non è ancora passato al cursore, e
spegnere il vecchio canale prima costerebbe lo streaming live. La migrazione
dell'ADR 0003 è incrementale apposta — doppia scrittura, poi il lettore nuovo,
poi si ritira il vecchio.

Restano fuori anche il lease/fence per il takeover fra worker (ADR 0002, gate
esplicito) e la potatura dei `progress` per i run che muoiono senza messaggio
definitivo: oggi quelle righe restano finché non arriva un messaggio su quel run.

## La migration 0226 non è applicata

`node scripts/schema-drift-check.mjs` dice che `thread_events` e
`chat_threads.event_head_seq` **non esistono nel database**: la 0226 è a file e
mai applicata, e i deploy di questo repo non le applicano.

Finché resta così, il lettore ricade su `chat_messages` come ha sempre fatto (la
`loadThreadEvents` cattura l'errore e torna `null`) e lo scrittore chiude la
corsia al primo append fallito, dopo un solo warning: il turno gira sul mirror
esattamente come prima. Niente di questo lavoro è visibile finché la migration
non viene applicata a mano.

## Il client legge per cursore

`brandChannel.onThreadSeq` ascolta il poke; la pagina del thread tiene una
`ThreadProjection`, e a ogni `seq` più alto del proprio cursore rilegge
`?thread=<id>&events_after=<cursor>` — una richiesta alla volta, il fold scarta da
solo ciò che sta sotto il cursore.

L'istantanea `progress` più recente per il run finisce dentro `applyLiveSnapshot`,
la funzione che già applicava lo snapshot assoluto del poll: il payload ha la
stessa forma, quindi non nasce un secondo percorso di rendering. Il poll a 4s
resta come rete, ma il testo ora arriva a 250ms invece che a 4 secondi.

**La prima sincronizzazione è una semina, non una novità.** Il cursore parte da
zero, quindi la prima lettura riporta tutto l'arretrato — inclusi gli eventi
`message` del backfill — e ricaricare lì sarebbe un lampo a ogni apertura del
thread. `foldThreadCursor` dichiara `seeded` e la ricarica si fa solo dopo.
