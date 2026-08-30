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
`20260829130000`) con una riga per effetto e una macchina a stati
`intended -> completed|failed`, coi ripieghi `ambiguous` (segmento morto a metà) e
`reconciled` (confermato fuori). La PR successiva sull’identità stabile ha sostituito la chiave
`tool+args` con `invocation_id` (`toolCallId`): due richieste distinte con lo stesso payload restano
distinte, mentre il resume deve conservare lo stesso id.

- **L’identità di una chiamata è il `toolCallId`, NON il `run_id`.** Così il claim atomico
  protegge la stessa chiamata se il run cambia, senza bloccare due richieste legittime con lo
  stesso payload. La vecchia `idempotency_key` resta solo per leggere le righe create dalla PR
  precedente; se un resume produce un nuovo `toolCallId`, il ledger non può riconoscerlo.
- **Il gate vive in `createApplyTool`, non nei singoli plugin.** È l'unico punto che esegue i
  tool; un tool dichiara `effectful: true` nel proprio `ToolSpec` e il gate lo avvolge — `intend`
  prima di eseguire, `resolve` dopo. I plugin (content, motion, ugc) non riscrivono la regola:
  la marcano. `buildTools` non cambia: il gate è sotto l'executor, il modello vede solo il
  catalogo di sempre.
- Le eccezioni catturate dal bridge dei tool diventano `ambiguous`, così un possibile side effect
  non torna automaticamente rieseguibile come un semplice fallimento dichiarato dal tool.
- **`decide()` è puro e testato.** `null` e `failed` rieseguono (nessun esito, o esito negativo:
  non è un doppione); `intended`/`completed`/`ambiguous`/`reconciled` congelano. Un `intended`
  viene sbloccato solo da un esito esplicito o da `reconcileRun`: senza lease non si può sapere
  se un secondo worker sia il proprietario vivo del claim, quindi il default è fail-closed.
- **`reconcileRun` tira gli orfani a `ambiguous`.** Chiamato dallo sweep alla morte di un run:
  gli `intended` rimasti soli diventano `ambiguous`, e il gate li congela. Solo `intended` è
  toccato: un `completed` è un esito vero.
- **Il port è nel contratto (`EffectsLedger`), l'implementazione nell'adapter app
  `agent-kit-effects-store.ts`, la logica in `effects.ts`.** L'executor dipende dall'interfaccia,
  la superficie (`live.ts`) passa
  l'implementazione col client admin. Il lab e i test senza ledger non cambiano comportamento.

Scartato: chiave per-run (non sopravvive a resume/takeover, che è il caso che il spec nomina);
gate per-tool nei plugin (una seconda fonte di verità); `reconciled` automatico (richiede di
sapere se l'effetto è davvero avvenuto, che è dominio del tool — oggi resta un esercizio manuale).

## Cosa guarda il test

- `effects.test.ts`: la chiave legacy è deterministica e
  order-insensitive e non collida tra intenzioni diverse.
- `agent-kit-effects-store.test.ts`: claim/resolve/reconcile su un finto client che
  applica i filtri per davvero (il compare-and-swap si verifica col codice di produzione).
- `executor.test.ts`: il gate — abort → resume con la stessa intenzione esegue UNA volta;
  un `ambiguous` non viene rieseguito nemmeno su un run nuovo; `failed` riesegue; solo i tool
  marcat `effectful` passano dal ledger.

## Da applicare a mano

La migration `20260829130000_agent_kit_effects.sql` (i deploy non eseguono le migration).
