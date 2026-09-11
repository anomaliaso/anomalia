# `refine_media` raffina una foto grande, e quando non può lo dice per davvero

Un caso reale: `refine_media` su un asset da **7.836.963 byte** rispondeva `404
source_not_found`. L'asset c'era — `kind: 'image'`, brand giusto, file nel bucket. Il 404 era
falso, e costava: l'agente esterno lo leggeva come «l'immagine non esiste» e **rigenerava da
zero**, cioè esattamente il danno che quel tool è stato costruito per impedire. L'originale del
cliente restava lì, un render nuovo veniva pagato, e la foto consegnata era un altro soggetto.

La catena era questa:

```
media-generate  resolveLibraryId      → l'asset lo trova (non era questo il not_found)
media-generate  loadLibraryMediaParts → resolveBrandImageIds → firma il path
brand-context   fetchImagePart        → tetto a 6.000.000 byte → null
media-generate  if (!parts.length)    → 'source_not_found'
```

`fetchImagePart` tornava `null` per tre motivi diversi — troppo grande, non è un'immagine, la rete
è caduta — e chi chiamava riceveva soltanto una lista vuota. Qualunque messaggio preciso richiedeva
che quella funzione smettesse di buttare via il perché.

## Cosa è cambiato

**`imagePartFor` dichiara il rifiuto** (`too_large` | `not_an_image` | `fetch_failed`);
`fetchImagePart` resta la stessa firma per i suoi quindici chiamanti ed è ora un involucro di due
righe. `loadLibraryMediaPart` porta l'esito fino a `runImageJob`, dove una tabella — `SOURCE_REFUSAL`,
una riga per motivo — decide l'errore: il tetto diventa `source_too_large` (413) con il **peso**
letto da `brand_media.bytes` e il **tetto**, tutto il resto resta `source_not_found`.

**Il tetto si aggira, non si alza.** 6 MB esiste per non far esplodere il contesto del modello, e
alzarlo sposterebbe il problema al primo file da 12 MB. Una sorgente sopra il tetto ora viene
**ridimensionata** prima di partire: si scarica fino a `RASTER_SOURCE_MAX_BYTES` (20 MB, il tetto
di ciò che accettiamo di decodificare) e si passa da `rasterToJpeg`, che era già in casa —
ridimensiona a lato lungo, riprova la qualità a scendere e si ferma sotto il budget di byte.
Nessuna dipendenza nuova: `sharp` era già qui, e `raster-image.ts` faceva già questo mestiere per
gli upload HEIC.

**2048 px di lato lungo**, non «sotto i 6 MB», perché la domanda giusta è quale risoluzione il
modello accetta davvero. La rotta viva dello slot immagini è OpenRouter (`SLOT_DEFAULT.image =
nano-banana@openrouter`, e `AI_ROUTE_IMAGE` non è impostata): lì non mandiamo NESSUN campo di
dimensione — solo `image_config.aspect_ratio` — e il modello torna alla sua taglia, dell'ordine di
1K. Sul ripiego kie la taglia è `resolution`, e in questo ambiente `KIE_IMAGE_RESOLUTION=2K`.
Quindi 2048 è il doppio dell'uscita sulla rotta viva e pari pari quella del ripiego: la piena
risoluzione di una foto da 24 megapixel non la vede nessuno dei due, e su OpenRouter la base
viaggia inline in base64 dentro il corpo JSON, cioè un terzo più pesante dei byte veri.

Il ridimensionamento sta in `imagePartFor`, cioè **dove la sorgente viene preparata per il
modello**, non all'import: l'originale del cliente resta com'è in libreria. Ne beneficiano anche
gli altri quattordici chiamanti — mood board, foto prodotto, riferimenti utente, catalogo — dove
una foto grande oggi spariva in silenzio.

## `import_media_url` non serve toccarlo

L'import ammette immagini fino a 12 MB, e la rifinitura ora ne decodifica 20: ogni file che
l'import deposita, il tool gemello lo sa leggere. Il buco si chiude da sé, quindi l'import non
avverte di niente e non cambia. Ciò che resta è un **test che tiene l'invariante**
(`IMAGE_MAX_BYTES <= RASTER_SOURCE_MAX_BYTES`): se domani qualcuno alza il tetto dell'import, il
test cade prima che un cliente ci trovi dentro un'altra foto «non trovata».

## Scartato

- **Alzare `IMAGE_PART_MAX_BYTES`**: sposta il muro, non lo toglie, e il contesto del modello lo
  paga su ogni riferimento, non solo su quello grande.
- **Ridimensionare all'import**: sostituirebbe l'originale del cliente con una copia più piccola.
  Chi importa un master lo importa apposta.
- **Cambiare la forma di `loadLibraryMediaParts`**: cinque chiamanti, quattro dei quali del motivo
  non sanno che farsene. La versione singolare che lo porta è nuova e la usa solo chi lo legge.
- **Un errore distinto per la rete caduta**: `fetch_failed` resta `source_not_found` come prima.
  È lo stesso genere di bugia, ma di un grado diverso, e va misurata con il suo caso prima di
  darle un nome.

## Il prezzo noto

Una PNG con trasparenza sopra i 6 MB esce da `rasterToJpeg` come JPEG, quindi su fondo nero. Prima
spariva del tutto, quindi è comunque meglio; se un giorno capiterà su un logo vero, la strada è un
ramo PNG dentro `rasterToJpeg`, non un secondo ridimensionatore qui.
