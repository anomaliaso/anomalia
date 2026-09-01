# Il riaggancio di un turno vivo è fedele, non un riassunto

## Il difetto

Scheda in background a metà turno kit: il canale Realtime muore, `isBenignDisconnect` scatta e la
sessione viva viene dimessa (`sessions.delete` — deliberato, PR #119: senza, il poll faceva
ricrescere lo stesso testo accanto alla bolla viva, doppione con barra rossa su un turno che
lavorava). Il poll `kit-run` riaggancia il run come orfano e ricostruisce la bolla **dallo
snapshot**. Da lì in poi si vedeva meno di un attimo prima:

- ogni pensiero — anche uno chiuso dieci minuti fa — ridipinto come «sta pensando»;
- i payload delle chip declassati alla copia troncata dello specchio.

## Cosa è risultato vero della diagnosi, e cosa no

**Il ragionamento: confermato alla lettera.** `ChatStreamState.reasoning` era **una stringa sola**.
I segmenti posizionati (`ChatReasoningSegment`) vivevano solo in `chat-session.ts`, piegati da un
`foldReasoningEvent` parallelo al reducer condiviso, e `TranscriptList` passava alla bolla orfana
`reasoningSegments: []`. Con la lista vuota `ChatLiveStatus` cade sul ramo legacy: **un** solo
`ChatThought` con `live={loading}`, e per un run orfano `loading` è sempre vero. Tutto il pensato
del turno, in un blocco, marcato attivo.

**Le chip: la causa dichiarata non regge.** Misurato: dopo il riaggancio `toolCallDetail` NON
torna `null` — lo specchio (`toolsForMirror`) i payload li porta, tagliati a
`MAX_MIRRORED_PAYLOAD_CHARS` (2000) e con la coda dichiarata `…[+N]`. La chip si apre. Quello che
si perde è il **contenuto**: un report di sotto-agente da novemila caratteri ne mostra duemila.

E sotto c'era un difetto vero, che il commento accanto negava: `mergeStreamToolCalls` scriveva
`input: t.input ?? had.input`, cioè preferiva il payload dello **snapshot** a quello che la scheda
aveva già letto dallo stream. Il primo poll dopo una disconnessione **declassava** i payload
interi a troncati, su ogni scheda che ne aveva. Il commento diceva l'opposto di quello che il
codice faceva.

## Dove si è chiuso il divario, e perché lì

Tre punti, ognuno il più vicino possibile alla causa:

1. **Il tipo dello stato** (`chat-stream-events.ts`). `ChatStreamState` porta ora
   `reasoningSegments` + `reasoningOpen`, e il reducer condiviso li piega. Un solo reducer li
   produce, quindi **anche lo specchio del server** li ha senza fare niente in più —
   `foldReasoningEvent` sparisce da `chat-session.ts` (era la stessa piega, scritta due volte).
2. **Lo snapshot** (`live.ts` → `applyLiveSnapshot`). `partial` e gli eventi `progress` scrivono
   `reasoningSegments` **al posto** della stringa piatta: stesso testo, ~35 byte in più per
   segmento, quindi il costo del poll non cambia. `assistantContentFromPartial` legge i segmenti
   (con fallback alla stringa per le righe scritte prima del deploy e per il motore v1).
3. **Il passaggio di consegne** (`takeLiveHandoff`). I payload interi non si rileggono dal server:
   la scheda **li ha già**, li ha letti dallo stream. Prima di `sessions.delete` la sessione li
   lascia in un handoff per thread, e il riaggancio ci semina `orphanState`. Zero byte di rete.
   `mergeStreamToolCalls` ora preferisce quello che la scheda ha (`had.input ?? t.input`), o il
   primo poll rimetterebbe la copia mozzata.

## Il costo del payload, scelto

Il poll è a 350ms (`LIVE_POLL_MS`): mandare i payload interi a ogni giro è escluso — un turno con
trenta chiamate li rimanderebbe tutti, interi, tre volte al secondo. Quindi **sul filo non cambia
niente**: la clamp a 2000 resta, i segmenti sostituiscono la stringa a parità di byte, e la
fedeltà dei payload arriva dall'handoff, che non passa dalla rete.

Il compromesso dichiarato: chi ricarica la pagina a mano (F5, o un'altra scheda che si aggancia
per la prima volta) non ha nessun handoff da consumare e vede i payload troncati come prima —
ma i pensieri, quelli, li vede giusti anche lì, perché arrivano dallo snapshot.

## Scartato

- **Payload interi nello snapshot**: risolve tutto e peggiora il traffico esattamente dove il
  vincolo lo vietava.
- **Un endpoint per il payload di una singola chip**: un giro di rete e una route in più per un
  caso che l'handoff copre a costo zero. Se un giorno servirà al reload duro, si valuta lì.
- **Togliere `sessions.delete`**: chiude un difetto peggiore (PR #119).
