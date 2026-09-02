# Log di debug sul turno kit: modello, durata, token

## Perché esiste

Il turno kit (`runKitTurn` in `src/lib/agent/bridge/live.ts`) finiva in silenzio: per diagnosticare
un run lento o un modello sbagliato bisognava leggere `ai_calls` a posteriori, o aggiungere un
console.log al volo. Quando qualcosa andava storto — un run che ci metteva minuti, un modello che
il resolver non aveva preso come previsto — non c'era nulla nel log di processo che dicesse cosa
stava girando.

## Cosa c'era prima

Lo stato dei run viveva già in `agent_kit_runs`, e `logAiCall` scriveva già una riga di
telemetria per turno (`model`, `ms`, token) — ma solo su database, mai nel log di debug del
worker. Il log di processo parlava solo delle anomalie (abort, retry, verdetto, sfratti).

## La decisione

Due righe nuove nel log di processo, una a inizio turno e una a fine turno:

- **start**: agente, modello (etichetta + provider), thread, run id. Detta SUBITO quale modello il
  resolver ha scelto, prima di qualsiasi attesa.
- **done**: durata in secondi, modello, token in/out. Riscatta il dato che `logAiCall` metteva su
  DB, rendendolo visibile nel log del worker.

Scartato: gatedare dietro un env var di debug. I log `[AGENT_KIT]` esistenti sono tutti
incondizionati, e una riga per turno è già il massimo del rumore accettabile — un flag avrebbe
chiesto di accenderlo ogni volta che serve, che è esattamente il momento in cui non lo si fa.
