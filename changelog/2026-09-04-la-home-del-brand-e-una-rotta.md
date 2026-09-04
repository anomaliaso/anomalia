# `/app/[brand]` rispondeva 404: la rotta non esisteva più

La #269 ha corretto due difetti veri della home del brand — il percorso relativo che usciva dal
brand e la corsa fra il rimando e il cookie dell'ultimo brand — spostando il rimando in cima a
`+layout.server.ts`. Quella parte è giusta e resta. Insieme, però, ha **cancellato**
`src/routes/app/[brand]/+page.server.ts`, e senza né `+page.server.ts` né `+page.svelte`
SvelteKit non ha una rotta da servire:

```
Error: Not found: /app/anomalia
    at resolve (node_modules/@sveltejs/kit/src/runtime/server/respond.js:711:13)
```

Il 404 nasce in `resolve()`, **prima** che parta un solo `load`. Il rimando messo nel layout non
viene mai raggiunto: la home del brand era irraggiungibile per tutti, e il sintomo non somigliava
alla causa.

## Cosa misura la correzione

`npx svelte-kit sync` genera i `$types` leggendo i file delle rotte. Prima:
`.svelte-kit/types/src/routes/app/[brand]/$types.d.ts` non nominava `PageServerLoad` nemmeno una
volta — non c'era una pagina. Dopo, due volte. È SvelteKit stesso a dire se la rotta esiste.

## I due rimandi non sono uno di troppo

Letto il runtime installato (`@sveltejs/kit` 2.63.1), le due strade fanno cose diverse:

- **Richiesta di pagina** (`server/page/index.js:253-281`): i `load` partono in parallelo, ma i
  risultati si consumano **in ordine di nodo** (`await server_promises[i]`), e i layout vengono
  prima della foglia. Vince il rimando del **layout**.
- **Navigazione dal client** (`server/data/index.js:99-104`, la `__data.json`): `Promise.all` e
  `throw error` immediato su un `Redirect` — vince **il primo che rigetta**, non il primo indice.
  È qui che stava la corsa della #269: il rimando nella pagina era sincrono, chiudeva la risposta,
  e il layout arrivava dopo alla riga del cookie con la risposta già generata
  (`respond.js:731-738` sostituisce `cookies.set` con un lancio).

Il rimando in cima al layout parte prima di qualunque `await`, quindi su entrambe le strade rigetta
per primo e il layout non arriva mai a scrivere il cookie: la corsa non esiste. Il `+page.server.ts`
esiste **perché la rotta esista** — il suo `load` oggi non scatta mai, ed è la rete se un domani
quella guardia si spostasse. Il rimando qui è assoluto: `./workbench` si risolve contro un URL
senza barra finale e atterra su `/app/workbench`, che non è la rotta di nessuno.

## Il test che mancava

`home-redirect.test.ts` provava il `load` del layout, e il `load` del layout non si accorge di un
404 che avviene prima di lui: i quattro test erano verdi mentre la home era rotta per tutti. Il
file ne guadagna due, che leggono la cartella dal disco:

- `/app/[brand]` contiene un file di pagina — è la proprietà che è saltata;
- una cartella di solo endpoint (`credits/`, che ha un `+server.ts` e basta) **non** ne contiene —
  il controllo sa dire di no, quindi il primo non passa a vuoto.
