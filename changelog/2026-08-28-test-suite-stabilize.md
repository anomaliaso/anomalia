# Stabilizzazione della suite: il numero di file rossi non è più una lotteria

La task #20 descriveva "9 poi 11 file rossi sullo stesso albero". La diagnosi
ha trovato tre cause sovrapposte, non una.

**Prima.** Vitest girava al default: `testTimeout` 5s, niente config. La suite
(509 file, test I/O-bound con pipeline asincrone vere su modelli finti) produceva
22–43 fallimenti a run, quasi tutti `Test timed out in 5000ms`; l'insieme dei
file rossi variava col carico della macchina. In più `queue-dm.test` sceglieva
il ramo kit/classico secondo l'`AGENT_KIT` del `.env` locale — passava su un
laptop e moriva sull'altro — e i test di fine turno di `live.test` aspettavano
il salvataggio asincrono con sonni fissi da 250ms.

**Decisioni.**
- `testTimeout: 120_000` in `vite.config.ts`: i turni kit completi toccano 40s da soli e
  oltre il minuto con la macchina satura. Un hang vero brucia in minuti, quindi la
  soglia resta un rilevatore.
- Guardrail perf di `redact` allargato da 200ms a 1s: misura 48ms da solo,
  ~300ms sotto carico; il regex catastrofico che il guardrail caccia brucia
  in secondi. Soglia sopra il rumore, sotto il disastro.
- `queue-dm.test` fissa `$env/dynamic/private` con `AGENT_KIT: 'off'`: la
  scelta del ramo è parte del test, non del computer che lo esegue.
- I tre test "thread incastrato" aspettano `vi.waitFor` sulla condizione
  finale invece del sonno fisso.

**Scartato.** Timeout per-test espliciti sui soli test lenti: un diff largo e
fragile a ogni nuovo test I/O-bound; il default largo uniforme costa al massimo
60s una volta su un hang vero.

**Ambiente, non codice.** Le 5 failure "deterministiche" di
`harness-pi-images` (`extractUserImages is not a function`) erano `node_modules`
stantie in worktree: `npm ci` + copia `.env` e la classe sparisce. Le lezioni
(nuovo worktree, env locale nei test, sonni fissi, timeout variabile) sono in
LESSONS.md.
