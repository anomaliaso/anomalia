# Tre patch che non applicavano più niente

`patch-package` gira nel `postinstall`. Le tre patch in `patches/` erano tutte inerti:

- `@ai-sdk/harness` — patch per la 1.0.87, installata la **1.0.101**
- `@ai-sdk/harness-pi` — patch per la 1.0.89, installata la **1.0.103**
- `@earendil-works/pi-ai` — il pacchetto **non è installato affatto**

Le prime due ottimizzavano `writeSkills`: quattordici file scritti uno a uno nella sandbox
costavano ~6,9 secondi prima che la chat potesse rispondere, e la patch li mandava tutti insieme.
Quell'ottimizzazione **oggi non c'è già più**, perché la patch non si applica da due release: il
codice installato è quello originale. Tenere il file non la restituisce, fa solo fallire l'install.

E il soggetto sta sparendo: `@ai-sdk/harness` è usato da `packages/agent-adapters` e da
`src/lib/agent/bridge/`, che escono con lo smantellamento dell'agent kit. Quando esce, anche la
dipendenza diventa candidata alla rimozione.

## Il sintomo, che non somigliava alla causa

`bun install` finiva con `patch-package finished with 3 error(s)`, e il dev server poi moriva su
`Cannot find module '@anomalia/site-analysis/crawl'` — un pacchetto di workspace, tre import più
in là, che con le patch non c'entra niente.

La causa vera dei link mancanti era un'altra (bun non ricreava `node_modules/@anomalia/`, e li ha
ricreati `npm install`), ma il rumore delle patch faceva sembrare rotto l'install e mandava a
cercare dalla parte sbagliata. Un errore che si ripete a ogni install e non protegge più niente
non è un avviso: è un depistaggio.
