# Il catalogo entra prima di uscire

`sync_products` cancellava il catalogo del brand e poi inseriva quello nuovo, senza leggere
l'`error` di nessuna delle due scritture, e rispondeva `{ ok: true, synced: 47 }`:

```ts
await supabase.from('products').delete().eq('brand_id', brand.id);
await supabase.from('products').insert(products.map(...));
```

Per mesi è stato un difetto **latente**: l'insert passava quasi sempre. Cinque giorni fa sono
arrivati i `CHECK` su `products` — `products_title_check`, `products_url_check`,
`products_images_shape`, `products_text_len` — e i titoli e gli URL li prende uno scraper da un
sito che non controlliamo. Un prodotto senza titolo, o con `example.com` invece di
`https://example.com`, adesso fa fallire l'insert. Ed è un INSERT solo con tutte le righe, che in
Postgres è atomico: **una riga malformata su quaranta e non ne entra nessuna**. Il catalogo è già
cancellato.

**Nessuna delle due PR poteva vederlo.** Quella dei vincoli guardava se i valori erano validi, non
chi leggeva l'errore quando non lo erano; quella della sincronizzazione è di mesi prima, quando
quel fallimento non esisteva. La lezione generale — *un vincolo nuovo rende raggiungibile ogni
`catch` muto sulla stessa tabella* — sta in [`LESSONS.md`](../LESSONS.md), perché è la cosa che si
ripeterà.

## L'ordine, scelto misurando

`replaceBrandCatalog` (`src/lib/server/product-catalog.ts`) inserisce prima e cancella dopo. Un
insert che fallisce lascia il catalogo di prima esattamente dov'era.

**Perché non una funzione plpgsql**, che darebbe una transazione vera e l'atomicità gratis: **i
deploy di questo repo non eseguono le migration.** Una funzione nuova non esisterebbe in
produzione finché qualcuno non lancia `db:migrate` — e una correzione contro la perdita di dati
che non è viva il giorno del merge non è una correzione. L'ordine invertito non chiede SQL nuovo
ed è attivo appena il deploy passa.

**Cosa si rompe con entrambi gli insiemi presenti per un istante**, verificato e non supposto:

- **Nessun vincolo lo vieta.** `products` non ha un unico su `(brand_id, external_id)` — la
  tabella è `0002_brand_kit_products.sql` e nessuna migration successiva ne aggiunge uno. Se ci
  fosse, questa strada sarebbe chiusa e servirebbe la transazione.
- **Tutti i lettori del catalogo sono `select`**: conteggi (`hub-overview`, `setup-checklist`,
  `growth-readiness`, `cli-queries`), titoli e immagini per i prompt (`radar`, `seo-agent`,
  `brand-file`, `system-prompt`, `creation-kit`). Nessuno riscrive quello che legge.
- Il peggio che può succedere è un conteggio doppio, o una lista prodotti duplicata in un prompt,
  per il tempo di un viaggio HTTP, durante una sincronizzazione che l'utente ha chiesto. Contro un
  catalogo cancellato per sempre non è un confronto.

La cancellazione del vecchio va a blocchi di 100 id: `delete().in('id', [...])` finisce
nell'URL, e un catalogo Shopify da 500 prodotti sfonderebbe il limite del proxy.

## La riga malformata non fa cadere le altre, e si dice quale

Il lotto parte intero — un viaggio, come prima. **Se fallisce**, si ritenta riga per riga: chi
passa entra, chi no torna al chiamante col **motivo che ha dato il database**. Il costo per riga
si paga solo quando qualcosa è già andato storto.

I vincoli **non sono riscritti in TypeScript** per filtrare prima. Sarebbe la stessa regola in due
posti, e una regola in due posti diverge al primo cambiamento della migration — in silenzio,
perché il ramo sbagliato non fallisce, semplicemente scarta la riga di troppo. Qui il posto è uno
solo: la migration dichiara, Postgres giudica, noi riportiamo.

E si riporta davvero: `rejected: [{title, reason}]` nella risposta REST, `products_rejected` nei
due job di chat, una riga rossa per scarto in `anomalia products <slug> sync`. Scartare in
silenzio sarebbe lo stesso difetto spostato di un metro.

Quando **non entra niente**, la rotta risponde `502` e dice che il catalogo di prima è intatto:
non è un successo parziale, ed è l'unico caso in cui il brand non ha ricevuto niente di nuovo.

## Tre chiamanti, una funzione

Lo stesso `delete`-poi-`insert` stava in tre posti: la rotta REST, il `sync_products` della chat e
la parte prodotti di `analyze_brand` (`job-executor.ts`). Correggere solo quello segnalato ne
avrebbe lasciati due a perdere cataloghi. Ora passano tutti da `replaceBrandCatalog`.

## Il test

`product-catalog.test.ts` e `products/server.sync.test.ts` fanno fallire **la scrittura** con
`failNext` del testkit e misurano due cose: che il catalogo di prima sia ancora in tabella, e che
la risposta non dica `synced`. Visti falliri sul codice vecchio — i tre della rotta rossi, con
`ok: true` e `synced: 2` su un catalogo appena cancellato.

Nell'harness dei vincoli è entrato il fatto che spiega la gravità: **una riga malformata rifiuta
tutto il lotto** (`23514`). Non si deduce leggendo `insert([...])` di supabase-js, e trasforma «un
prodotto rotto» in «zero prodotti». Gli altri sei `CHECK` su `products` erano già provati lì.
