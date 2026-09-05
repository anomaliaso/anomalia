# Una grafica che non è di nessun post

`design_graphic` aveva `post_id` obbligatorio — `z.string()`, non `.optional()`. Quindi «fammi una
grafica, ma niente post» **non era esprimibile**: comporre una grafica voleva dire creare un post,
che l'utente aveva appena vietato.

L'agente sceglieva allora `generate_image`, l'unico strumento capace di produrre un'immagine senza
toccare un post. Ma `generate_image` fa una **foto AI**, non una grafica tipografica. Da fuori
sembrava disobbedienza; era l'unica mossa legale, e dava la cosa sbagliata.

Ora `post_id` è opzionale. Senza, la grafica nasce nella libreria media come qualunque altra
immagine generata, e la sua versione viaggia con l'asset (`kind: 'media_item'`, che il magazzino
delle grafiche conosceva già dal primo giorno). Resta **sorgente**, quindi «accorcia il titolo» è
una revisione e non una ricomposizione da zero; `media_id` la riprende. Da lì
`create_post_from_asset` la trasforma in un post quando — e se — glielo si chiede.

## Come è costruita

Il catalogo delle immagini che il compositore può usare — allegati del turno, url passati a mano,
libreria, persone e talent firmati, foto del prodotto, e il marchio del brand kit per primo così
`ref:0` è il lockup vero — è uscito da `designPostGraphic` in `graphicImageCatalog`, in un commit
separato che non cambia comportamento. Niente di quel blocco riguardava un post tranne il nome del
prodotto e la piattaforma, che ora sono argomenti: una grafica senza post ha bisogno esattamente
dello stesso catalogo.

## Verificato

Stack locale, brand `demo`, browser reale. Chiesta la grafica vietando i post: l'agente chiama
`content_design_graphic` (non più `generate_image`) e i post del brand restano **zero**.

Il caricamento in Storage fallisce su questa macchina — `extended attributes disabled`, un limite
del container su Docker/macOS che colpisce identicamente il percorso preesistente delle foto (v.
[`LESSONS.md`](../LESSONS.md)). La logica di persistenza è coperta dai test con l'upload finto:
nessun post creato, l'asset salvato come modificabile con la sua versione, e `media_id` che
revisiona la stessa tessera invece di impilare tentativi.
