# Identità stabile per le chiamate tool

Il ledger introdotto dalla PR #70 usava tool e argomenti come identità. Questo proteggeva i resume,
ma impediva due richieste legittime con lo stesso payload.

Ora l'executor usa il `toolCallId` del runtime come identità stabile: il runtime lo persiste nella
storia e nei partial, mentre `agent_kit_effects.invocation_id` lo rende unico per brand. Gli
argomenti restano il payload registrato e vengono confrontati per rifiutare il riuso della stessa
identità con dati diversi.

Il claim è atomico nel database. Un solo worker può eseguire; un claim già `completed`, `ambiguous`
o `reconciled` non riparte; un `failed` può essere reclamato. Le righe vecchie restano leggibili:
la vecchia chiave vale solo per il run che le aveva create, così un run nuovo non collassa con un
effetto legacy.

`invocation_id` non dipende da `run_id`, sequenza degli eventi, lease, fence o attempt: questi
restano metadati di orchestrazione e possono evolvere senza cambiare l'identità della chiamata.

La migration `20260829180000_agent_kit_effect_identity.sql` va applicata manualmente: i deploy del
repo non eseguono le migration.

Le righe legacy senza `run_id` o senza un `toolCallId` rigiocabile non sono correlabili a una nuova
identità; richiedono riconciliazione manuale prima di un retry.
