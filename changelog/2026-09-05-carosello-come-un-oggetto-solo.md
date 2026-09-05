# `generate_carousel`: N slide che si leggono come un oggetto solo

Andrea ha chiesto il tool e si è fatto da solo la domanda giusta: *«se però l'ai vuole modificare
una sola slide, come fa?»*

## La logica non è stata riscritta, è stata estratta

Le regole del carosello esistevano già, dentro il prompt del batch in `caption-quality.ts`, e sono
buone. Il pezzo che decide tutto:

> *repeat the SAME 2-3 continuity tokens (palette words, recurring motif, lighting phrase) verbatim
> in EVERY slide prompt so the rendered series reads as one object, not N unrelated images*

più il mestiere: la copertina deve leggersi **a dimensione miniatura** — un soggetto, forme grandi e
semplici, alto contrasto, al massimo 4 parole citate; ogni slide successiva avanza di **un passo
concreto** e porta **una sola idea** — *«una slide che ha bisogno di due frasi per essere descritta è
due slide»*.

Sono uscite dal prompt e sono diventate `CAROUSEL_CRAFT`, **una costante sola che entrambi i
percorsi citano**. Non una copia: il prompt del batch ora interpola la costante, e un test asserisce
che la vecchia stringa non compaia più nel file. Due copie sarebbero divergute alla prima
correzione, e la metà rimasta indietro avrebbe continuato a girare in silenzio.

**E non è stata parafrasata.** Se «ripeti gli STESSI 2-3 gettoni ALLA LETTERA» diventa «mantieni uno
stile coerente», la logica è persa e **nessun test se ne accorge**: le immagini tornano comunque,
solo scollegate. Un test tiene ferme le parole che portano il peso — `verbatim in EVERY slide
prompt`, `THUMBNAIL size`, `exactly ONE idea`, `two sentences to describe is two slides`.

## La risposta alla domanda di Andrea: nessun tool nuovo

**Per modificare la terza slide si usa `refine_image` sul suo id.** Esiste già e funziona meglio di
un rigenera-slide: prende l'immagine come `base_media_id` e la **modifica**, invece di ridisegnarla
da un prompt. I gettoni sono già nei pixel, quindi la coerenza si conserva per costruzione.

**Ma c'è un modo in cui si rompe**, ed è coperto: se l'istruzione tocca palette, luce o il motivo
ricorrente, quella slide esce dalla serie e niente avvisa. Quindi il carosello **restituisce i
gettoni** — le parole letterali, non una descrizione — e la descrizione del tool dice in una riga di
rimetterli nell'istruzione.

## Il gettone mancante si inietta, non si ripaga

Il modello a volte dimentica un gettone in una slide. Rifiutare il piano significherebbe ripagare la
pianificazione; `enforceContinuity` aggiunge in coda al prompt solo i gettoni che mancano davvero,
lasciando intatto ciò che già li aveva. È la stessa scelta del `craftFloor`: **un ingrediente si
inietta, non si spera.**

## Cosa NON è stato toccato

- **`regenerate_slide`** resta: è legato ai post, funziona, ha chiamanti. Qui si aggiunge il
  soggetto che mancava.
- **`create_post`** non è toccato né rinominato.
- Il numero di slide viene da `CAROUSEL_MIN_SLIDES` e `carouselMaxSlides()`, che erano già lì.
