# L'elenco dei post nel frontend sottile — `/v2/:brand/posts`

La seconda superficie del frontend sottile, dopo il calendario. Elenca i post del brand con
stato, piattaforme e data, si filtra per stato, e apre il singolo post in un pannello laterale
dove si modifica la copy e si approva.

## Perché esiste, visto che c'è il calendario

Il calendario risponde a "cosa esce questo mese". Non risponde a "cosa è fallito", né a "cosa ho
pubblicato finora": un post senza data non ha una casella, e uno di tre mesi fa è a tre click di
navigazione. La lista è l'altro asse dello stesso dato — per stato invece che per giorno — ed è
l'unico modo per vedere in un colpo la coda `failed`, che nel calendario è invisibile.

## Cosa c'era prima

`/app/:brand/posts` nel vecchio frontend. Verrà smantellato: `/v2` è il prefisso temporaneo
finché `/app` è occupato, e la promozione finale sarà `git mv src/routes/v2 src/routes/app`.

## Come è costruita

**Legge dagli endpoint, non dal database.** Il `load` prende il token dalla sessione e chiama
`GET /api/v1/brands/:slug` (per il fuso del brand) e `GET /api/v1/brands/:slug/posts?status=…`
in parallelo. Le due azioni chiamano `PUT /posts/:id` e `POST /posts/:id/approve`. Nessun import
da `$lib/server/cli-queries`: web, MCP e CLI passano dalle stesse regole di prodotto.

**Il filtro sta nella URL, non in memoria.** `?status=failed` è un link: il server rifà la
query e la pagina si ridisegna. Nessuno store, nessuna cache, nessuna sincronizzazione — l'unico
stato client è quale pannello è aperto, e anche quello è scritto in `?post=<id>` con
`replaceState`, così un reload o un link condiviso lo ripristinano.

`filterFor` non si fida del parametro: uno stato che non è nella tabella torna ad `all`, così la
URL non può inventare un filtro che l'API non conosce.

**Le condizioni stanno in una tabella sola.** `POST_STATES` dice per ogni stato l'etichetta, il
tono del badge, se si modifica e se si approva. Uno stato sconosciuto non concede niente. Le
stesse righe generano i filtri (`STATUS_FILTERS`), quindi aggiungere uno stato è aggiungere una
riga, non toccare tre punti.

**Il fuso è quello del brand.** `whenLabel` formatta con `Intl.DateTimeFormat` sul timezone che
arriva dall'API: le 23:30 UTC del 31 agosto sono il 1 settembre a Roma, e mostrare la data del
server sposterebbe di un giorno ogni post serale. È lo stesso difetto che il calendario ha già
pagato una volta, quindi qui c'è un test che lo pinna.

## Cosa è stato scartato

**Nessuna primitiva nuova.** Il pannello del calendario usa `textarea` e `alert-dialog` di
shadcn. Qui il testo è un `<textarea>` con le classi dell'`input` esistente, e la conferma
dell'approvazione è a due passi in linea (il bottone diventa "Yes, distribute it" / "Keep it
pending"). Due ragioni: meno JavaScript sul primo render, e soprattutto nessuna collisione
add/add con la PR del calendario, che aggiunge quegli stessi 14 file. Se la conferma in linea si
rivelasse debole, il passaggio ad `alert-dialog` è un cambio di componente, non di flusso.

**Nessuna utility `grid`.** `app.css` definisce un `.grid` globale (`grid-template-columns:
1.7fr 1fr`) che dirotta chiunque usi la classe `grid` senza un `grid-cols-*` accanto. La lista è
una colonna flex: il problema non si presenta invece di essere aggirato.

**Nessuna chat, nessun link alla chat.** Le chat escono dal prodotto.

**Nessuna paginazione.** `getPosts` risponde con i 50 più recenti per data di creazione; la
pagina lo dice in fondo invece di fingere di mostrare tutto. Paginare vuol dire cambiare
l'endpoint, e l'endpoint lo usano anche CLI e MCP: è un lavoro suo, non di questa superficie.

## Debito noto

Il pannello e la tabella degli stati sono un doppione di quelli in
`src/routes/v2/[brand]/calendar/` (PR #229): le due PR sono indipendenti per non incatenare
l'ordine di merge con nove agenti in parallelo. Quando entrambe sono su `dev`, la pulizia è
spostare `post-state.ts` e `PostPanel.svelte` a `src/routes/v2/[brand]/` e ripuntare due import.
