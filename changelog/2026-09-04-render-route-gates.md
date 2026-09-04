# Il render da CLI passa dal gate come tutti gli altri

`POST /api/v1/brands/:slug/posts/:id/render` produce la stessa immagine di
`POST /api/v1/brands/:slug/posts/:id/media` (`action: 'regenerate'`), ma era l'unica delle due a
non chiamare né `gateAiAction` né `withBrandContext`. Due conseguenze, entrambe silenziose:

- **un brand senza piano e senza crediti renderizzava lo stesso.** `gateCredits` non veniva mai
  interrogato: la rotta caricava il post e chiamava direttamente `renderPreviewImages`.
- **il render non compariva in `ai_calls`.** L'attribuzione al brand viaggia su una
  `AsyncLocalStorage` che `withBrandContext` apre al confine della richiesta; senza quel wrapper
  le righe scritte da `logAiCall` nascono senza `brand_id`, quindi il costo di quelle immagini
  non entra nella spesa di nessuno — e la spesa è esattamente ciò che `gateCredits` legge al giro
  dopo. Il buco si alimentava da solo.

La correzione non inventa niente: sono gli stessi due helper della rotta sorella, con gli stessi
parametri.

**Dove sta il gate.** Dopo i tre controlli di stato del post (non esiste, non ha `image_prompt`,
ha già un'immagine), non prima. Quei tre rami non spendono un centesimo: gatearli significherebbe
rispondere 402 a chi chiede un render che non sarebbe partito comunque.

**Sulla chiave di sola lettura.** Il difetto era stato segnalato anche come «una API key
read-only può spendere». Non è (più) vero sul percorso HTTP: `resolveCaller` nega ogni non-GET a
una chiave senza scope `write` prima ancora che la rotta parta, e `/render` è solo POST. Il test
che copre il caso lo fa comunque, ma sulla difesa della rotta — `gateAiAction` chiama
`checkApiKeyWriteAccess` come prima cosa — perché è la difesa che la rotta sorella ha e questa
non aveva, e perché il giorno che qualcuno aggiunge un GET qui il controllo centrale smette di
coprire.

**Scartato: mockare `gateAiAction` nel test.** Il difetto era «la rotta non lo chiama»: un mock
del gate non può accorgersene, perché un mock non chiamato e un gate assente si assomigliano
troppo. Il test importa il modulo vero e sostituisce solo `authenticate` e `loadBrandForUser`,
così il 403 e il 402 arrivano dal codice che li produce in produzione.

**Scartato: allineare anche `maxDuration`.** La rotta sorella dichiara
`export const config = { maxDuration: 300 }` e questa no, il che è probabilmente un difetto a sé
(un carosello lungo può superare il default). È un cambio di comportamento del deploy, non un
gate: sta in un'altra PR.
