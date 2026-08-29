# Il ledger degli effetti dei tool: un post/schedulazione, mai due

## Perché esiste

Un turno agent che muore a metà (funzione terminata dalla piattaforma, crash, deadline) e viene
ripreso ripartiva dalla storia e rieseguiva i tool di scrittura alla cieca. Il caso concreto:
un turno crea un post (`content_create_post`) o lo schedula (`content_schedule`), il segmento
muore dopo che l'effetto è avvenuto ma prima che il run si chiuda, il resume o un takeover
rieseguono la stessa intenzione e il post esce due volte. Oggi il rischio era governato da guard
ad-hoc per-tool, non da idempotenza dichiarativa: ogni tool riscriveva la propria regola, e la
regola divergeva silenziosamente al primo cambio.

## Cosa c'era prima

Nessun ledger. Il patch `@ai-sdk/harness-pi` re-inviava gli step al resume, `recoverDeadPartial`
promuoveva il partial salvato, ma nessuno dei due sapeva dire "questo effetto è già stato fatto".

## La decisione

Portare il pattern `ExternalEffect` di Rakazo: una tabella `agent_kit_effects` (migration
`20260829130000`) con una riga per effetto, `idempotency_key` deterministica e una macchina a
stati `intended -> completed|failed`, coi ripieghi `ambiguous` (segmento morto a metà) e
`reconciled` (confermato fuori). Le scelte che contano:

- **La chiave contiene brand + nome tool + args canonicalizzati, NON il run_id.** Così
  l'idempotenza riconosce la stessa intenzione attraverso un resume (che riparte da zero) e un
  takeover, non solo alla ripresa dello stesso run. Order-insensitive (chiavi ordinate), e la
  lunghezza del payload è codificata nella chiave per evitare collisioni da troncamento. L'hash
  è FNV-1a a 64 bit: la chiave è un indice, non un segreto, e niente `crypto` asincrona.
- **Il gate vive in `createApplyTool`, non nei singoli plugin.** È l'unico punto che esegue i
  tool; un tool dichiara `effectful: true` nel proprio `ToolSpec` e il gate lo avvolge — `intend`
  prima di eseguire, `resolve` dopo. I plugin (content, motion, ugc) non riscrivono la regola:
  la marcano. `buildTools` non cambia: il gate è sotto l'executor, il modello vede solo il
  catalogo di sempre.
- **`decide()` è puro e testato.** `null` e `failed` rieseguono (nessun esito, o esito negativo:
  non è un doppione); `completed`/`ambiguous`/`reconciled` congelano. `intended` è il caso "il
  run corrente è il primo autore" (il segmento è vivo): decide() lo lascia riprovare, perché
  congelarlo bloccherebbe l'unico tentativo vero.
- **`reconcileRun` tira gli orfani a `ambiguous`.** Chiamato dallo sweep alla morte di un run:
  gli `intended` rimasti soli diventano `ambiguous`, e il gate li congelatile. Solo `intended` è
  toccato: un `completed` è un esito vero.
- **Il port è nel contratto (`EffectsLedger`), l'implementazione in `effects-store.ts`, la logica
  in `effects.ts`.** L'executor dipende dall'interfaccia, la superficie (`live.ts`) passa
  l'implementazione col client admin. Il lab e i test senza ledger non cambiano comportamento.

Scartato: chiave per-run (non sopravvive a resume/takeover, che è il caso che il spec nomina);
gate per-tool nei plugin (una seconda fonte di verità); `reconciled` automatico (richiede di
sapere se l'effetto è davvero avvenuto, che è dominio del tool — oggi resta un esercizio manuale).

## Cosa guarda il test

- `effects.test.ts`: la macchina a stati di `decide`, e che `effectKey` è deterministica e
  order-insensitive e non collida tra intenzioni diverse.
- `effects-store.test.ts`: `intend`/`find`/`resolve`/`reconcileRun` su un finto client che
  applica i filtri per davvero (il compare-and-swap si verifica col codice di produzione).
- `executor.test.ts`: il gate — abort → resume con la stessa intenzione esegue UNA volta;
  un `ambiguous` non viene rieseguito nemmeno su un run nuovo; `failed` riesegue; solo i tool
  marcat `effectful` passano dal ledger.

## Da applicare a mano

La migration `20260829130000_agent_kit_effects.sql` (i deploy non eseguono le migration).
