# Un thread nuovo paga UNA partenza, non due

## Cosa c'era prima

`runKitTurn` avvolgeva il primo `startTurnOnce(false)` in un try/catch; se il
`harness_start_timeout` (60 s) scattava, il catch scartava la sessione viva e
riprovava con `startTurnOnce(true)`, ma lo faceva SEMPRE — anche su un thread
nuovo dove non c'era nessuna sessione da riusare.

## Il difetto

Su un thread NUOVO il primo avvio è già una creazione fresca (nessuna sessione in
cache): se il modello è lento a montarsi oltre il timeout, il retry ne creava una
SECONDA identica. Due avvii a freddo = due minuti, e il log `la sessione riusata
non partiva` accusava una sessione riusata mai esistita.

## Cosa è cambiato

Il retry ora è condizionato da `hasLiveHarnessSession(threadId)`: c'è una
sessione in cache → il primo tentativo stava RIUSANDO qualcosa → il retry
fresco ha senso. Non c'è cache → niente da salvare → `throw firstStartError`,
il turno lo dice una volta.

## Decisioni scartate

- Togliere il retry del tutto: avrebbe rovinato il caso legittimo della sessione
  riusata che muore (`msg1 ok, msg2 500`), per cui il retry esiste.
- Allungare `HARNESS_START_TIMEOUT_MS`: sposta il problema sul lato del riuso
  senza toccare la radice — il doppio avvio restava.
