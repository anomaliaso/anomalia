# Nano Banana 2 Lite come default

Cosa c'era: ogni render con riferimenti da riprodurre (post social con persone, prodotto,
immagine base, UGC cover, avatar persone) girava su Nano Banana Pro — l'id `gemini-3-pro-image-preview`,
18 crediti a immagine su kie. Il resto andava già su modelli più economici (blog su Nano Banana 2).

Cosa cambia: il default di render passa a **Nano Banana 2 Lite** (`nano-banana-2-lite` su kie,
`gemini-3.1-flash-lite-image` su Google) su tutte le superfici, dietro richiesta esplicita:
il costo per immagine scende e la latenza pure, a scapito della fedeltà massima su dettaglio
e fotorealismo. Pro non è più default da nessuna parte ma resta raggiungibile passando un
modello esplicito al call site.

Decisioni prese:

- La mappatura in `kieImageModel` resta una regola sul nome (`lite` ⇒ `nano-banana-2-lite`)
  invece di un'elenco di id: un id nuovo non la fa invecchiare.
- `buildKieImageInput` ora conosce il dialetto Lite: i riferimenti vanno in `image_urls` (cap 10,
  documentazione kie) e `resolution`/`output_format` NON vengono inviati — sulla Lite quei campi
  non esistono, e inviarli era un payload sbagliato che funzionava per sbaglio.
- Il tetto di prodotto sui riferimenti resta `KIE_IMAGE_INPUT_MAX = 8`: è il minimo fra le cap
  dei tre modelli e governa a monte dove si sa che cosa sono i riferimenti.
- Tariffa RATES per `gemini-3.1-flash-lite-image` messa a parità di Nano Banana 2 come limite
  prudente superiore: sul trasporto kie (default) il costo vero arriva comunque da
  `creditsConsumed` sul poll, la tariffa serve solo al trasporto Google (people).
- La stima di budget dell'image agent resta sul listino Pro: finché i crediti Lite non sono
  misurati, Pro list è il limite superiore prudente; la fattura vera sta in `ai_calls`.

Scartato: un env `KIE_IMAGE_MODEL` globale. Il cambio di modello è già una decisione di
call site (`opts.model`), una seconda leva globale avrebbe avuto due chiavi che si correggono.
