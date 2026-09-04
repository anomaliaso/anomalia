# La conta dei test in CLAUDE.md era ferma a 5200

Sono ~7.000. Una cifra che nessuno aggiorna smette di essere un'informazione: chi la legge non
sa più se il numero descrive la suite o l'anno scorso.

## E il rosso locale che non è un rosso

Nello stesso conteggio sono emersi 13 test rossi in locale su `dev` — `hooks.server`, e tre file
sotto `src/lib/agent/bridge/` con `extractUserText is not a function`, `extractUserImages is not
a function`, `Invalid URL`. Sembravano il segno di uno smantellamento che aveva cancellato
qualcosa di vivo.

Non lo erano. Quei simboli non sono codice nostro: arrivavano da una patch `patch-package` su
`@ai-sdk/harness-pi`, rimossa perché non applicava più alla versione installata (v.
`2026-09-04-patch-scadute.md`). In locale l'installazione non li ha; **sulla CI quei due file
passano** — `pi-stream.test.ts` ✓ 4 test, `harness-pi-images.test.ts` ✓ 5 test, suite a 7.028
passati e zero falliti. `hooks.server.test.ts` passa anche in locale, da solo: era interferenza
fra test in parallelo.

Cancellare quei test perché rossi in locale avrebbe buttato via copertura funzionante. La lezione
— guardare la CI prima di credere a un rosso locale — è finita in `LESSONS.md`, accanto a quella
sul `node_modules` stantio che nomina già gli stessi simboli e che da sola non è bastata.
