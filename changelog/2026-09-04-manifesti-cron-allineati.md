# Tre cron che sul self-hosted non si erano mai fermati

## Cosa girava e non doveva

Il repo ha **due pianificatori**: `vercel.json` per l'installazione hosted e
`docker/cron/sidecar.mjs` per il self-hosted. Sono liste separate, e nessuno le
teneva insieme. Tre cron spenti su Vercel continuavano a partire sul sidecar:

- **`/api/v1/market/harvest`** (`40 6 * * *`) e **`/api/v1/market/trends`**
  (`20 */4 * * *`) — spenti il 2026-08-29 perche' costavano **$26 ogni 30 giorni**
  di scrape senza brand (13.367 chiamate, 65% della spesa scrapecreators, in
  crescita 4x in un mese). Tolti da `vercel.json`, lasciati nel sidecar: per una
  settimana ogni installazione self-hosted ha continuato a pagare quel conto.
- **`/api/v1/custom-agents/tick`** (`*/5 * * * *`) — spento oggi con la PR #258
  perche' faceva **288 esecuzioni AI al giorno**, ognuna capace di aprire un thread
  e far lavorare un agente a spese del brand. Quella PR ha cancellato anche la
  rotta: il sidecar oggi bussa a un 404 ogni cinque minuti, e prima del 258
  faceva partire davvero gli agenti.

Tutti e tre via dal sidecar. La direzione e' quella: i due kill di costo erano
decisioni di piattaforma, non scelte di deploy, e il terzo non ha piu' nemmeno
una rotta da chiamare.

## La divergenza che resta, ed e' dichiarata

**`/api/v1/chat/models/sync`** gira su Vercel e non sul sidecar. Popola
`chat_model_catalog`, il menu modelli della chat. La chat sta venendo smantellata,
quindi la domanda vera — serve ancora a qualcuno dei due? — e' una decisione di
prodotto, non di allineamento. Resta com'e', ma smette di essere una dimenticanza:
e' una riga nella tabella `DIVERGENZE_MOTIVATE` del test, con scritto perche'.

## Perche' il guardiano non l'ha visto

`docker/cron/sidecar.test.mjs` c'era gia', e asseriva
`defaultManifest.length === 43`. Due difetti, e il secondo e' il peggiore:

1. **Un conteggio non vede uno scambio.** Togli una voce e aggiungine un'altra e
   il numero non si muove. Non si e' accorto di tre cron in piu' e uno in meno.
2. **Non lo eseguiva nessuno.** File `node:test`, mentre `vite.config.ts` include
   solo `src/**`, `packages/**`, `scripts/**` — e sono `.{js,ts}`, quindi nemmeno
   il glob avrebbe preso un `.mjs`. Ne' `npm run test:unit` ne' la CI lo hanno mai
   aperto. Era **rosso su `dev`** da quando il manifesto e' sceso a 42 voci, e
   nessuno poteva vederlo.

Un guardiano senza runner e' peggio di nessun guardiano: da' l'impressione di
esserci.

## Cosa e' stato fatto perche' venga eseguito

- `vite.config.ts`: aggiunto `docker/**/*.{test,spec}.{js,mjs,ts}` agli `include`
  di vitest. La CI gira `npx vitest run`, quindi da qui in poi lo esegue.
- `sidecar.test.mjs`: `import test from 'node:test'` diventa
  `import { test } from 'vitest'`. Una riga. Le asserzioni restano
  `node:assert/strict`, che sotto vitest funziona identico: zero churn sul resto
  del file, che di per se' e' un buon test del parser cron.
- Il conteggio secco e' sostituito dalla proprieta' che serve davvero: **i due
  manifesti contengono gli stessi path e le stesse cadenze, salvo un elenco
  dichiarato di eccezioni motivate**. `vercel.json` viene letto davvero, non
  ricopiato a mano. Il messaggio dell'asserzione dice cosa fare: spegnilo anche
  di la', o dichiaralo.

Rosso prima del verde, due volte: il vecchio test rosso (`42 !== 43`) e il nuovo
test rosso sullo stato non allineato, che ha stampato esattamente i tre path.

## Scartato

- **Copiare `vercel.json` nel sidecar a runtime.** Il file di Vercel non e' sempre
  raggiungibile da dentro l'immagine Docker, e il manifesto embedded e' quello che
  fa girare l'installazione anche senza il repo. La copia resta, ma ora un test la
  sorveglia.
- **Convertire il file a `.test.ts`.** Il sidecar e' `.mjs` di proposito — gira in
  un container senza toolchain — e il test lo importa direttamente. Cambiare
  estensione al test avrebbe chiesto di cambiarla anche al modulo.
- **Allineare `chat/models/sync` da solo.** E' una decisione di prodotto sulla
  chat, non un difetto di lista.
