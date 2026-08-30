# La chip di un tool non sopravvive al proprio stream

## Perché

Il 27/8 (riga di produzione `7bc0f716` di `agent_kit_runs`) la sessione è
morta a metà di un `delegate_task`. Il turno è ripreso con una sessione
fresca, che non riemette il risultato del call precedente: il partial del
run ha quindi conservato la chip `running` senza output per tutto il resto
del turno — loading perpetuo in UI, refresh per sbloccare.

Due buchi si sommavano:

1. **Server (mirror).** `mirrorSseToRun` scrive il partial con lo stato
   piegato dallo stream; a stream finito una chip ancora `running` non
   riceverà più nulla, ma restava tale nel partial servito dal poll.
2. **Client (poll).** `applyLiveSnapshot` Mergeava i tool solo quando il
   loro numero cresceva: una transizione di stato (running→done) senza
   aggiunte non veniva mai riparata, quindi nemmeno un partial vero
   avrebbe chiuso la chip.

## Decisione

- Nuovo `closeDanglingToolCalls` in `chat-stream-events.ts` (il modulo
  condiviso server/client): a stream terminato per cosa sua (evento
  `finish` o `error` visto) ogni chip ancora aperta diventa `error` con
  un testo onesto. Se invece il mirror si ghiaccia per un client andato
  via, lo stato resta com'è: le chip aperte possono essere legittime,
  il turno continua senza di noi.
- `applyLiveSnapshot` mergea anche a lunghezza invariata (ma mai con
  meno tool di quelli che la tab conosce: lo snapshot non rimpicciolisce
  la lista).
- Scelti i dati prima della teoria: la query su `agent_kit_runs` dei 7
  giorni mostra un run con `open_delegate: 1` nel partial finale e tutti
  gli altri chiusi — conferma che il difetto è nel lifecycle del mirror,
  non nell'emissione generale dei risultati.

## Scartato

Riscrivere il partial alla chiusura del run dalla verità degli `steps`:
dopo `closeRunSaving` il run esce dagli stati working e il poll risponde
204 — il partial riconciliato non verrebbe mai letto. La riparazione sta
nel mirror, dove il partial vive ancora.
