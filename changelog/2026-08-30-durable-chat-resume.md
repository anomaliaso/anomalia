# Durable chat resume

## Perché

Un refresh o la chiusura della tab potevano lasciare il transcript e lo stato del turno su
percorsi separati. Le nuove feature dovevano essere verificabili nella chat reale, non solo nel
runtime isolato.

## Decisioni

- `thread_events` è append-only, sequenziato per thread e idempotente per `source_key`.
- I messaggi finali entrano nel log tramite trigger nella stessa transazione dell'inserimento; il
  reader usa un reducer unico e torna al percorso legacy se trova un log incompleto.
- Le richieste HITL `ask` salvano input redatto per la UI, continuation state e messaggio assistant
  in una sola RPC.
- Il resume verifica run, approval id e tool call id; una seconda decisione identica non rilancia
  un turno già ripreso.
- Il judge può autorizzare automaticamente il default consequential; `ask` e gli errori restano
  fail-closed e attendono una persona.
