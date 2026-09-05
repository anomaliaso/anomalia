# `done` senza `media_id` non è più una risposta che si può dare

`check_media_job` ha risposto ad Andrea `status: 'done', media_id: null`, e il suo agente esterno
si è fermato lì — giustamente: il contratto dello stesso tool dice l'opposto, «done once it is in
the library — and then media_id is the id create_post accepts». Un `done` senza id non è un lavoro
riuscito e non è un lavoro fallito: è una frase che non dice niente su cosa fare dopo.

## Perché è successo, che non è dove sembrava

Il deposito in libreria **c'è ed è protetto**, in `video-render-queue.ts`: `applyToPost` instrada
a `applyToLibrary` quando `post_id` è nullo, e il chiamante non segna `done` finché quella non
riesce. Leggendo `dev` il difetto è impossibile.

Il codice che ha scritto `done` non è quello. È uno **split brain fra deploy**:

| | codice | ruolo |
|---|---|---|
| `localhost:5173` di Andrea | `dev` | l'unico che accoda un render con `post_id` nullo |
| produzione (`anomalia.so`) | `main`@`cce7f4e8`, 2 settembre | il cron `*/1` che riconcilia |

Il database è **lo stesso**. E `main` non ha ancora `9fa00158`: il suo `applyToPost` è
`if (!row.post_id) return true;`. Un render senza post viene quindi dichiarato atterrato senza che
niente lo depositi, l'allocazione mensile viene addebitata, e la riga si chiude `done`.

La riga `d616dcda-8a2f-4017-b9e6-74542f77a8cd` lo dice per intero: `status done`, `post_id` nullo,
`attempts 0`, `error` nullo, `media_url` valorizzato — e **zero** righe `brand_media` con quel
`source_ref`. L'mp4 risponde `200` con 2.098.026 byte. Il clip esiste, è pagato, e nessun tool del
prodotto sa raggiungerlo.

## Cosa cambia qui, e cosa no

Qui non si tocca la scrittura: quel lato lo chiude il merge di `dev` su `main`, e il messaggio di
errore del reconciler lo sta già riscrivendo un'altra PR. Qui si chiude il **lato lettura**, che è
la superficie su cui l'agente esterno si è arreso, e che ripete la contraddizione **chiunque**
abbia scritto `done`: un deploy indietro, una `UPDATE` a mano, una regressione futura.

`listMediaJobs` filtra già `post_id is null`, quindi per le righe che restituisce l'invariante è
esatta: **`done` vuol dire che l'asset c'è**. Se non c'è, il lavoro non viene più riportato `done`.

Non viene riportato nemmeno `failed`, ed è la parte che conta: il clip è stato renderizzato e
**pagato**, `media_url` lo prova. Un agente che legge `failed` rigenera, ed è la reazione giusta
al messaggio sbagliato — pagherebbe una seconda copia di un file che esiste già. Serviva una
terza parola vera, e `not_in_library` è quella: il `error` dice cos'è successo e dice di non
rigenerare.

## Il test

L'invariante di scrittura — nessun `done` con `post_id` nullo senza una `brand_media` che lo
reclami — **passa già** su `dev`, perché `9fa00158` l'ha chiusa, e sta nei test di
`video-render-queue`. Ripeterla qui non avrebbe misurato niente.

Il rosso è dall'altra parte del confine, e riproduce esattamente la sessione: dato un lavoro
`done` che nessun asset reclama, `listMediaJobs` rispondeva `done` con `media_id: null` e `error`
nullo. I tre controlli intorno — il caso felice, un lavoro in corso, un lavoro fallito davvero —
passavano già prima e continuano a passare: sono lì perché la guardia non può diventare una rete
che cattura anche loro.
