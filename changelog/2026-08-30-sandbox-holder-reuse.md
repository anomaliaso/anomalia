# La sandbox del thread sopravvive al turno, non solo al comando

## Perché esiste

`2026-08-29-sandbox-refcount-stop.md` aveva chiuso l'idle billing rilasciando l'holder nel
`finally` di ogni turno — corretto per un consulto isolato, ma un thread che scambia più
messaggi di fila (usando la sandbox a ogni giro) pagava una `openBrandSandbox` +
`provider.createSession()` piena — provisioning della VM, non solo lo `stop()` — a OGNI turno,
anche quando l'utente rispondeva un secondo dopo. Costo e latenza ripetuti per riaprire la
stessa macchina appena richiusa.

## La decisione

Il brand sandbox entra nella stessa cache per-thread che già tiene la sessione harness
(`moduleLiveSessions`): una mappa module-level `liveSandboxSessions` (adapters.ts) tiene la
`Promise<HarnessSandboxSession>` per `sessionKey` (il `threadId`). Il turno che segue trova la
sandbox già aperta e non paga un secondo provisioning.

- **Stessa chiave, stesso destino**: `dropLiveHarnessSession` rilascia ENTRAMBE le cache
  insieme — se la sessione harness se ne va (turno rotto, abort, sfratto), la sandbox la segue.
  Niente split-brain fra le due mappe.
- **Il `finally` per-turno sparisce**: non è più corretto rilasciare a ogni turno riuscito —
  significherebbe pagare di nuovo il provisioning al turno successivo. Il costo massimo resta
  comunque limitato dal lease nativo della sandbox (`SANDBOX_MAX_LEASE_MS`, 15 minuti): un
  thread abbandonato smette di pagare da solo, come prima di questo cambio.
- **Promise cache, non solo il valore**: due `openBrandHarnessSession` concorrenti sullo stesso
  `sessionKey` (prima che il primo risolva) condividono la stessa apertura in corso — niente
  doppio provisioning per una race.

## Due difetti ereditati, corretti qui

- Il percorso di retry dopo un errore di `finish` riapriva la sandbox e, se la riapertura
  falliva, azzerava `brandSandbox` ma continuava a leggere `brandSandbox.session` — `TypeError`
  catturato dal `catch` più esterno, che quindi ABBANDONAVA il rilancio invece di ritentare senza
  sandbox. Test rosso prima (`live.test.ts`, scenario con la riapertura che fallisce), poi
  `brandSandbox?.session` — il rilancio ora arriva in fondo anche a mani vuote.
- `dropLiveHarnessSession` usciva subito (`if (!entry) return`) quando la sessione harness non
  era MAI arrivata in cache — ma la sandbox poteva esserci lo stesso (aperta, sessione harness
  mai cacciata prima di un errore). La sandbox restava aperta per sempre nella mappa
  module-level, mai rilasciata. Test rosso prima (`adapters.test.ts`, apre la sandbox senza mai
  passare da `startHarnessTurn`), poi le due cache si controllano indipendentemente.

## Verificato

- `live.test.ts` 71/71 (tenuta fino a fine consumo, riuso fra due turni dello stesso thread,
  retry sopravvive a una riapertura fallita), `adapters.test.ts` 20/20 (riuso per sessionKey,
  race su apertura concorrente, drop senza sessione harness cacciata), `sandbox-leases.test.ts`
  8/8.
- `sandbox-leases.integration.test.ts` 4/4 contro lo stack disposable
  (`SANDBOX_HOLDER_INTEGRATION=1`, Postgres/Kong/Auth/Rest/Storage reali via
  `scripts/task85-disposable.sh`, con l'healthcheck di `storage` allungato — sotto carico il
  boot reale supera i 25s di prima).
- Browser reale (Chrome via `agent-browser`, non headless) contro l'app in dev mode sullo stesso
  stack disposable, login col seed reale, brand `demo`: tre turni sullo stesso thread —
  risposta semplice, poi due comandi shell REALI con marcatore in stdout — con la STESSA riga
  `sandbox_holders` (stesso `id`, stesso `sandbox_name`, stesso `holder_key`) letta dal database
  prima e durante il terzo turno, mai duplicata. Reload a metà sessione, un turno interrotto con
  Stop verificato `state=aborted` e la riga rilasciata (`sandbox_holders` torna a zero righe).
  `npm run build:node` di produzione ha impiegato ~28 minuti per contesa di macchina (5+
  worktree con build/typecheck concorrenti sulla stessa macchina condivisa — non un difetto del
  codice, vedi LESSONS.md): la verifica browser ha usato `vite dev` sullo stesso stack Postgres
  già migrato e seedato, non meno reale ai fini del test.
