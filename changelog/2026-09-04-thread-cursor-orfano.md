# Il cursore del thread se ne va con la pagina che lo leggeva

`src/lib/thread-cursor.ts` piegava gli eventi grezzi di `thread_events` nella proiezione di
`@anomalia/agent-kit/thread-events`: quale messaggio è arrivato, a che punto sta il run, dove
riprendere a leggere. Serviva a **chattare**, e a una cosa sola — la pagina
`src/routes/app/[brand]/chat/[thread]/+page.svelte`, che rendeva la risposta a metà mentre lo
stream avanzava.

Quella pagina è uscita con `3d1ad40` («Remove the chat routes and unmount it from the app shell»).
Il modulo è rimasto: nessun importatore, solo il suo test a tenerlo in vita. Un test che è
l'unico chiamante non è copertura, è un ancoraggio — e questo ancorava un intero pacchetto:

```
$ git grep -n "foldThreadCursor\|seedThreadProjection\|latestRunProgress" -- src cli scripts packages
src/lib/thread-cursor.test.ts: …
src/lib/thread-cursor.ts: …
```

Fuori da `src/lib/agent/` e `src/lib/server/chat/` — le due cartelle che stanno per sparire —
`thread-cursor.ts` era **l'unico** file del repo a importare `@anomalia/agent-kit`. Restano
`src/lib/server/agent-kit-effects-store.ts` (`@anomalia/agent-kit` + `@anomalia/agent-core/effects`,
chiamato solo da `bridge/live.ts` e da `agent-kit-recover.ts`) e tre file che prendono da
`@anomalia/agent-contracts` **solo tipi** (`chat-tiers.ts`, `chat-model-policy.ts`,
`models/catalog.ts`): import cancellati in build, vivi solo per il typecheck.

Non c'è changelog pubblico: il cliente non vedeva questo file nemmeno quando la pagina c'era.
