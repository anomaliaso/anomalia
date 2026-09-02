# La chat smette di rispedirsi la cronologia ogni tre secondi

Misurato su un thread da 200 messaggi (100 renderizzati, il tetto di `loadThreadUiHistory`), stack
locale, browser vero. Non un sospetto: numeri.

## Cosa costava

**Il poll dei lavori in background.** Mentre un job gira, `tickToolWatch` rifaceva l'INTERO
transcript a ogni tick: **202 KB e 176 ms** per cento messaggi, venti volte al minuto, per un testo
quasi sempre identico a sé stesso. Poi riassegnava `messages`, quindi ogni turno riceveva oggetti
nuovi e la cronologia si ridisegnava tutta.

**Il markdown.** `renderMd` è puro e non ricordava niente: **~40 ms per cento turni, uguali a ogni
passata**. Quel costo si pagava a ogni ridisegno, cioè a ogni tick del poll.

**La lista dei thread.** `refreshThreads` non sa degli altri sei chiamanti: all'apertura di un
thread partivano **tre `/chat/threads` identiche nello stesso secondo** — novantaquattro thread,
63 KB, sei query lato server ciascuna — più tre `console.log` per chiamata spediti in produzione.

**Due scansioni quadratiche in `TranscriptList`.** `isLastUser` e `followingUserTexts` scorrevano
la coda della lista per OGNI riga: su cento turni cinquemila passi e cento array nuovi a ogni
ridisegno. `followingUserTexts` serve solo alla card domande, che quasi nessun turno ha.

## Cosa cambia

**Il tick chiede il delta, non la storia.** Il thread ha già un registro durevole con cursore —
`thread_events`, e a scriverlo è un trigger su ogni insert di `chat_messages`, quindi copre ogni
percorso: stream, worker, CLI. La pagina lo legge già per `thread-seq` (`syncThreadCursor`), che
ricarica il transcript SOLO quando un messaggio è davvero atterrato. Il watcher ora si limita a
battere: `onMessages` diventa `onTick`, e la pagina avanza il proprio cursore.

Misurato nel browser con un job vivo: due tick producono quattro richieste per **0,41 KB in tutto**
— `pending_tools` 0,19 KB, `events_after` 0,015 KB — e **zero** chiamate al transcript. Da ~202 KB
a ~0,2 KB per tick.

**`renderMd` ricorda per testo.** Mappa limitata a 400 voci (una cronologia intera ne porta 100),
sfratto del più vecchio con l'ordine di inserimento della Map. Misurato: rifare cento turni già
visti passa da **~40 ms a 0,1 ms**.

**`refreshThreads` restituisce la promessa in volo.** Tre chiamate concorrenti fanno una fetch
sola; finita quella, la successiva riparte davvero. E i tre `console.log` non ci sono più.

**Le due scansioni spariscono.** `lastUserIndex` si calcola una volta; `followingUserTexts` passa
come getter, quindi il giro quadratico avviene solo per il turno raro che mostra la card domande.

**`content-visibility: auto` su ogni turno.** Cento turni sono renderizzati, dieci stanno sullo
schermo, e il browser non aveva modo di sapere che poteva saltare gli altri novanta.
`contain-intrinsic-size: auto 180px` è l'altezza dichiarata finché il turno resta fuori campo, così
la barra di scorrimento non salta quando entra.

## Quello che NON si è fatto, e perché

**Chiavare la lista sull'id del messaggio.** Sembra l'ovvio miglioramento e invece spegne la lista:
il carico del thread può contenere due righe con lo stesso id (un checkpoint parziale e la sua
versione finale — osservato su una cronologia vera: stesso id, stesso testo, due tool contro
dieci), e Svelte su una chiave duplicata non disegna il blocco. Transcript vuoto, nessun errore a
schermo. Verificato nel browser cambiando la sola riga della chiave, avanti e indietro. Si potrà
fare quando `consolidateMessages` produrrà una chiave sua, unica per riga; fino ad allora la chiave
resta la posizione e `transcript-key.test.ts` lo tiene fermo.

**Import dinamico per le venti card di `ChatTurn`.** Il nodo della rotta pesa 91 KB non compressi
su una base condivisa di ~1 MB decodificati: la resa massima è intorno all'1% del critico, contro
dieci `{#await}` dentro il file che non si deve rompere. Non paga.

**La barra azioni al hover.** Quattro bottoni e quattro icone per turno sono ~800 nodi su cento
turni, ma senza hover — cioè su ogni schermo tattile — quelle azioni diventano irraggiungibili.
`content-visibility` prende gran parte dello stesso beneficio senza togliere niente a nessuno.
