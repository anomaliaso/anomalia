# Sentry non è più la cosa più pesante che l'app scarica prima di disegnare

Misurato, non sospettato: due build identici a meno del client Sentry, stesso metodo su entrambi
(grafo di import statico del bundle client, nodi `[0, 5, 6, 150]` della rotta chat, raw e gzip).

| | percorso critico chat | `entry/app.js` | file JS |
| --- | --- | --- | --- |
| prima | 1.972 KB raw / **611,4 KB gz** | 303,8 / **93,7 gz** | 143 |
| dopo | 1.755 KB raw / **537,8 KB gz** | 83,1 / **20,1 gz** | 141 |
| Sentry tolto del tutto (tetto) | 1.642 KB raw / 488,0 KB gz | 82,0 / 19,3 gz | 140 |

**−217 KB raw, −73,6 KB gzip: il 12,0% del critico.** Il file d'ingresso — quello che OGNI pagina
dell'app scarica prima di disegnare qualsiasi cosa — cala del 78%.

## Cos'era

`hooks.client.ts` importava `@sentry/sveltekit` staticamente. Sono **329 moduli** `@sentry/*` nel
bundle client (222 solo `@sentry/core`), quindi finivano dentro `entry/app.js` e stavano sulla
strada del primo fotogramma sempre — anche sulle pagine dove non succede niente da segnalare, che
sono tutte tranne quelle rotte. L'init era già condizionato (dev, DSN mancante, pagine marketing),
ma condizionare l'INIT non toglie i byte: quelli li porta l'`import`.

## Cosa cambia

L'import diventa dinamico e parte quando il browser è libero (`requestIdleCallback`, tetto 3 s)
sulle pagine dell'app; sulle marketing resta legato alla prima interazione, come già faceva il
replay. Il modulo si carica una volta sola (`sentryModule ??= import(...)`), e `init` conserva
esattamente le opzioni e le tre guardie di prima.

`error-report.ts` dell'onboarding aveva lo stesso import statico e riceve lo stesso trattamento:
la funzione gira solo quando è già andata male, quindi i byte li paga allora.

## Il buco che apre, e la rete che lo copre

Fra il caricamento della pagina e l'idle c'è una finestra senza nessuno che raccolga gli errori —
ed è proprio la finestra in cui l'app si idrata, cioè dove succedono quelli interessanti. Prima
quella finestra era quasi zero sulle pagine dell'app, perché l'init girava al caricamento del
modulo.

`$lib/sentry-buffer` la copre: due listener globali (`error`, `unhandledrejection`) armati subito,
che costano nulla e non importano niente, tengono da parte fino a venti errori e li rigiocano con
`captureException` appena il client è pronto. Dopo il primo svuotamento la coda si spegne per
sempre — da lì in poi ci sono gli handler globali di Sentry, e continuare a ricordare vorrebbe
dire spedire tutto due volte. È la proprietà che i test pinnano.

L'errore che passa dall'hook `handleError` di SvelteKit paga il caricamento del modulo se non è
ancora arrivato: succede una volta, e solo quando qualcosa è già rotto.

## Perché non gli altri candidati

Nella stessa analisi (plugin Rollup temporaneo che risale gli importatori) sono stati misurati e
scartati:

- **zod, 18 KB gz (2,9%)** — ingresso unico, `chat-model-policy.ts` che importa a runtime lo schema
  `AgentModelPolicy` da `@anomalia/agent-contracts/contracts`. Toglierlo vuol dire spezzare un
  package condiviso e riscrivere a mano la validazione. Non paga.
- **supabase-js, 56 KB gz (9,2%)** — importatore applicativo unico (`src/lib/supabase/client.ts`),
  ma la chat lo usa SEMPRE per il canale Realtime: un import dinamico non lo toglie dal critico, lo
  sposta di un istante. L'unica rimozione vera è `@supabase/realtime-js` nudo con token e refresh
  scritti in casa: non si tocca l'auth per il 6,5%.
- **CSS morto** — non esiste. I 192 `Unused CSS selector` che il build stampa sono selettori che
  Svelte ha già rimosso, e infatti fra i due build il CSS è identico al byte (322 KB / 59,6 gz).

## Quello che resta

Fra il risultato (537,8) e il tetto della rimozione totale (488,0) ci sono 49,8 KB gz: non un
blocco di Sentry rimasto in piedi, ma l'strumentazione che il plugin `sentrySvelteKit()` intreccia
in altri chunk, più le differenze di partizionamento fra i due build. Toglierla vorrebbe dire
rinunciare al plugin, cioè alle tracce: non è lo stesso scambio.
