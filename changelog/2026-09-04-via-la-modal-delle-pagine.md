# Le pagine del brand tornano pagine

Sotto `/app/[brand]/` ci sono 96 rotte vere, ciascuna col suo URL e il suo `load`.
Quarantasei di quelle, su desktop, non si vedevano mai come pagine: un interceptor
sul click le catturava e `PageModal` montava la loro `+page.svelte` dentro un dialogo,
sopra la pagina viva, senza cambiare l'URL del browser. Il meccanismo funzionava — ma
era un involucro di presentazione costruito sopra un sistema di rotte già completo, e
si portava dietro un elenco di stringhe che doveva rispecchiare il filesystem a mano.

Se ne va tutto. Le rotte non si toccano: erano già lì.

## Cosa spariva dietro l'involucro

- **L'URL.** Con la modal aperta la barra degli indirizzi mostrava la pagina sotto. Una
  pagina non era condivisibile, il tasto indietro non la chiudeva, e il titolo della
  scheda andava tenuto fermo con un `MutationObserver` per non farsi rinominare.
- **I parametri.** Siccome l'URL non cambiava, `page.url.searchParams` era quello della
  pagina sotto: `$lib/page-query.ts` esisteva per aggirarlo, e sei pagine passavano da
  lì per leggere `?doc=`, `?edit=`, `?row=`.
- **Le action.** Le `?/azione` relative SvelteKit le risolve contro l'URL del browser, che
  nella modal non era mai quello della pagina ospitata: servivano un handler in cattura
  sul submit e una patch a `window.fetch` per applicare il risultato a mano.
- **Il titolo.** `PageHead` scriveva in un raccoglitore di contesto invece che nello store
  globale, perché una pagina ospitata avrebbe riscritto il topbar della pagina sotto.

Nessuna di queste quattro complicazioni ha più una ragione: erano il prezzo di far
sembrare una pagina qualcos'altro.

## L'elenco che si staccava

`BRAND_MODAL_ROUTES` erano 46 stringhe che dovevano corrispondere alle cartelle su disco,
tenute allineate da un test che cammina il filesystem. Ha fatto rossa la CI due volte in
un giorno, sempre per lo stesso motivo: si aggiunge o si sposta una rotta e nessun grafo
di import lo vede. Se ne va con la modal, e con lei `BRAND_PAGE_ROUTES`,
`brandModalTarget` e `page-modal-tiers.test.ts`.

La palette ⌘K era l'unico consumatore di prodotto di quell'elenco. Adesso legge le rotte
dal glob di Vite: le pagine che stanno su disco, meno le dinamiche (nessun href statico),
meno le impostazioni (hanno il loro gruppo) e meno `activate`/`success`/`proposal`, che
sono passaggi di pagamento e non destinazioni da cercare. Una pagina nuova si cerca il
giorno che esiste; una cancellata sparisce da sola.

## Il rail del telefono resta, ma dice la verità

Il drawer del burger montava `PageRail` per due famiglie: le impostazioni e le pagine del
brand. Le seconde non gli servono più — con la sidebar del brand raggiungibile da ovunque,
il rail era una seconda navigazione per le stesse voci. Adesso il drawer si arma **solo**
sotto `/settings`, dove `SettingsSidebar` non è montata e senza di lui non si andrebbe da
nessuna parte. `overlay-route.ts` sparisce: la domanda «questa pagina vive in una
sovrapposizione?» aveva senso finché le sovrapposizioni erano due.

`SETTINGS_MODAL_GROUPS` diventa `SETTINGS_GROUPS`: è la mappa delle impostazioni, la
leggono il rail e ⌘K, e non ha più niente a che vedere con una modal. Le altre quattro
costanti a tier (`SETTINGS_MODAL_SECTIONS`, `SETTINGS_MODAL_WIDE`, `SETTINGS_MODAL_DEFAULT`,
`SETTINGS_FULL_PAGE_SECTIONS`) non avevano consumatori fuori dalla modal e dal suo test.

## Il ritorno dalle pagine post e dall'editor

`backHref($pageModalOrigin, fallback)` serviva a tornare *da dove si era aperta la modal*.
Senza modal l'origine è sempre nulla e la funzione restituiva già il fallback: le tre
pagine (`posts/[id]`, `posts/[id]/edit`, `site/edit/[id]`) puntano direttamente al
calendario e al blog. Il test che sorveglia la cancellazione dal post editor legge quella
riga per stringa: è stato visto fallire prima di essere aggiornato, che è l'unico modo di
sapere che sorvegliava davvero qualcosa.

## Cosa NON è cambiato

Nessuna `+page.svelte` è stata riscritta, nessuna rotta spostata, nessun `load` toccato.
`settings-shell.css` resta (lo importano il layout delle impostazioni e `/app/billing`), e
resta la regola `:global(.settings-shell)` del guscio che toglie il `max-width` alle pagine
a piena larghezza.
