# La libreria media nel frontend sottile — `/v2/:brand/materials`

La terza superficie del frontend sottile, dopo il calendario (#229) e l'elenco dei post (#235).
È "Materiali" nel mockup della barra laterale: la libreria di ciò che il brand possiede già —
foto, render, esport — con anteprime, filtro per tipo, ricerca testuale e apertura del singolo
elemento in un pannello laterale.

## Perché esiste

Il resto di `/v2` mostra cosa esce. Nessuna superficie mostra cosa c'è. È l'asset che decide se
un post costa zero o costa un render: `create_post` accetta `media_ids`, e un id preso dalla
libreria riusa un'immagine invece di pagarne una nuova. Senza una pagina che mostri quegli id,
l'unico modo per conoscerli è `list_media` da CLI — cioè la libreria esiste per gli agenti e non
per la persona che deve dire "usa quella".

Il pannello quindi mostra l'id per esteso, in monospace, selezionabile. Non è un dettaglio
tecnico lasciato scoperto: è la ragione per cui si apre un elemento.

## Cosa c'era prima

`/app/:brand/...` nel vecchio frontend. `/v2` è il prefisso temporaneo finché `/app` è occupato;
la promozione finale sarà `git mv src/routes/v2 src/routes/app`.

## Come è costruita

**Legge da un endpoint, non dal database.** Il `load` prende il token dalla sessione e chiama in
parallelo `GET /api/v1/brands/:slug` (per nome e fuso del brand) e
`GET /api/v1/brands/:slug/media` (`LIST_MEDIA`). Nessun import da `$lib/server/brand-media`: web,
MCP e CLI passano dalle stesse regole.

**Sola lettura.** `POST /media` esiste (`IMPORT_MEDIA_URL`: importa da una URL pubblica) ma è un
flusso di scrittura con i suoi errori — `media_unavailable`, dimensioni, mime rifiutati — e non
è quello che questa superficie deve risolvere. Nessun upload, nessuna modifica, nessuna
cancellazione: la libreria si riempie da upload, render e agenti.

**Il filtro sta nella URL.** `?kind=video` è un link, `?q=menu` è una `<form method="GET">`. Il
server rifà la query e la pagina si ridisegna. Nessuno store, nessuna cache. L'unico stato
client è quale pannello è aperto, scritto in `?item=<id>` con `replaceState` così che un reload o
un link condiviso lo ripristinino.

`kindFor` non si fida del parametro: un tipo che non è nella tabella torna ad `all`.

**Il filtro per tipo è lato server, ma non è una query.** `LIST_MEDIA` accetta `query` e `limit`,
non `kind`: il tipo non è filtrabile dall'API. Le due strade erano aggiungere un parametro
all'endpoint — che usano anche CLI e MCP — o filtrare le righe già arrivate. La seconda, in
`load`, perché la prima è lavoro dell'endpoint e non di questa pagina, e perché `ofKind` su una
lista che l'API già limita non è una query mascherata: è la stessa scelta di `filterFor` in #235,
un parametro di URL che non può inventare uno stato che l'API non conosce.

**La ricerca invece passa davvero dall'API.** `?q=` diventa `?query=` su `LIST_MEDIA`, che cerca
su titolo, descrizione e tag. Duplicare quella ricerca nel frontend avrebbe voluto dire due
definizioni di "corrisponde", divergenti al primo cambio.

**Il fuso è quello del brand.** `addedOn` formatta `created_at` con `Intl.DateTimeFormat` sul
timezone che arriva dall'API: le 23:30 UTC del 31 agosto sono il 1 settembre a Roma. Un test lo
pinna, come in #229 e #235.

## Cosa non si può mostrare, e perché non è stato inventato

`LIST_MEDIA` restituisce dieci campi: `id`, `kind`, `mime`, `width`, `height`, `title`,
`description`, `tags`, `signed_url`, `created_at`. La riga in `brand_media` ne ha molti di più —
`source`, `bytes`, `duration_seconds`, `times_used`, `last_used_at`, `suggested_use`,
`when_to_use`, `how_to_use`, `where_to_use`, `subjects`, `colors`, `mood`, `catalog_status`.

Sono esattamente le cose che questa pagina vorrebbe: **quante volte un asset è già stato usato**
(per non ripubblicare la stessa foto), **quando l'ultima volta**, e le indicazioni d'uso che
l'AI ha già scritto catalogando il file. Nessuna passa dall'endpoint, quindi nessuna è mostrata.
Allargare `LIST_MEDIA` è un cambio di contratto che tocca anche CLI e MCP: è un PR suo.

Un `signed_url` nullo non diventa un'anteprima rotta — il pannello lo dice.

## Cosa è stato scartato

**Nessuna primitiva nuova da `shadcn-svelte`.** Solo `sheet` e `badge`, già in
`src/lib/components/ui/`. La ricerca è un `<input type="search">` con le classi dell'`input`
esistente: `shadcn-svelte add` ha già riscritto `button.svelte` e alzato `tailwind-variants` due
volte, e non c'è niente qui che lo giustifichi.

**Nessuna utility `grid`.** `app.css` definisce un `.grid` globale
(`grid-template-columns: 1.7fr 1fr`) che dirotta chiunque scriva la classe. La griglia di
anteprime è `flex flex-wrap` con larghezza fissa per elemento: il problema non si presenta
invece di essere aggirato.

**Nessun `<video>` nella griglia.** Un elemento video per riquadro significa una richiesta di
rete per riquadro al primo render. In griglia un video è un riquadro con la sua etichetta; il
player esiste solo nel pannello, che è a import dinamico e quindi non entra nel bundle iniziale.

**Nessuna paginazione.** `LIST_MEDIA` accetta `limit` (max 200) ma non un cursore: paginare
davvero vuol dire cambiare l'endpoint. La pagina dice quanti ne mostra invece di fingere di
mostrarli tutti.

**Nessuna chat, nessun link alla chat.**

**Nessuna barra laterale.** Le cinque voci del mockup sono un layout condiviso, e due delle
cinque non esistono ancora: un link che darebbe 404 non si mette. Il layout arriva quando le
superfici ci sono tutte.

## Debito noto

Nessuno nuovo. `media-kind.ts` non duplica niente di `post-state.ts`: sono due tabelle diverse
su due domini diversi. Resta aperto il doppione già noto fra #229, #235 e #236 (`PostPanel`,
`POST_STATES`, `momentInZone`), che questa PR non tocca perché non usa nessuno dei tre.
