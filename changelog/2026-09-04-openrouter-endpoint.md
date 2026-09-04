# OpenRouter è un endpoint del registro, e serve le immagini

Il registro delle rotte conosceva quattro endpoint — `google`, `kie`, `xiaomi`, `deepseek`. Ora ne
conosce cinque. `openrouter` è una riga per tabella (`Endpoint`, `MISSING`, `LOG_PROVIDER`,
`endpointConfigured`), esattamente la forma che quel file ha di proposito: aggiungere un endpoint
non deve voler dire scrivere un `if` da qualche altra parte.

Niente default si sposta. `AI_ROUTE_IMAGE=nano-banana@openrouter` lo accende, e senza quella
variabile tutto resta dov'era: testo su Google, immagini e voce su kie. `google`, `xiaomi` e
`deepseek` restano accesi — sono l'interruttore di emergenza, e si toglie un interruttore dopo
aver misurato in produzione, non prima.

## Perché, coi numeri

Immagini, stesso modello Google, stesso prompt:

| | kie `nano-banana-2-lite` | OpenRouter `google/gemini-3.1-flash-lite-image` |
|---|---|---|
| tempo | 16,5s · 42,1s · 16,4s (media 25,0s) | 3,2s · 2,7s · 4,2s (media 3,4s) |
| costo per render | 4 crediti ≈ $0,020 | $0,0336 |

**+68% di prezzo, un settimo del tempo.** È una scelta di latenza, non di risparmio, e il commento
sul ramo lo dice per chi legge dopo — perché su questo file l'assunzione naturale è la contraria.

Il regalo vero non è nella tabella: su OpenRouter il render è **una richiesta sincrona**. Niente
`createTask`, niente polling, quindi il difetto dei task abbandonati-e-fatturati — un job che
scade da noi mentre il provider continua a lavorare e a mandare il conto — **non esiste per
costruzione** su questo percorso. Su kie è costato render pagati due volte.

Per la stessa ragione il ramo non ritenta: un fallimento sincrono torna già diagnosticato in
millisecondi (misurato: 28ms per un id di modello inesistente), e `generateImageOnOpenrouter` alza
l'eccezione invece di restituire `undefined`. Una risposta senza parte immagine **non è un
successo**: era il modo più facile di sbagliare qui, ed è un test.

## Il rapporto d'aspetto, che è la trappola

OpenRouter inoltra il rapporto d'aspetto solo dentro `image_config.aspect_ratio`. Misurato, stesso
prompt, stesso modello:

- senza il campo → **1408x768** (panoramico)
- con `image_config.aspect_ratio: '4:5'` → **928x1152** (4:5)
- con `extra_body.imageConfig.aspectRatio` → 1408x768, cioè ignorato

Senza quel campo ogni post Instagram del brand sarebbe uscito inquadrato in panoramica, con
risposta 200 e nessun errore da nessuna parte. È il motivo per cui c'è un test sul corpo della
richiesta e non solo sull'estrazione dell'immagine.

## Il costo lo dice chi fattura

La riga in `ai_calls` prende `flatCostUsd` da `usage.cost` di OpenRouter, non da `RATES`. Verificato
che `usage.cost` coincide alla sesta cifra decimale con la tariffa dell'endpoint a monte, e che
`cost_details.upstream_inference_cost` è identico a `cost` — OpenRouter non mette markup sul token,
si paga sull'acquisto dei crediti. `provider` scrive `openrouter`, così la misura in produzione è
leggibile il giorno dopo senza indovinare da quale trasporto è passata una riga.

## Quello che NON è in questa PR, e perché

- **Il testo.** Il registro ora accetta `gemini@openrouter`, ma `geminiTransport()` conosce solo
  `kie` e `google`: una rotta del testo verso openrouter finirebbe **in silenzio su Google**. Non è
  un difetto introdotto qui (vale già per `gemini@xiaomi`), ma diventa raggiungibile in un modo che
  sembra supportato. Il trasporto del testo è la PR successiva, e va fatta prima di scrivere quella
  variabile in produzione.
- **Il video.** OpenRouter lo serve su una superficie separata (`/api/v1/videos`, 28 modelli), che è
  asincrona come kie e quindi non porta il regalo del sincrono. Storia sua.
- **Il catalogo a tre modalità.** `chat_model_catalog` non ha una colonna di modalità; darne una è
  una migrazione, e i deploy qui non eseguono migrazioni. Storia sua.

## Un difetto trovato mentre misuravo, e non corretto qui

`RATES` in `ai-log.ts` prezza `gemini-3.7-flash` a **$1,50 / $7,50** per milione di token. Il
listino Google di oggi è **$0,75 / $3,75**: quello a $1,50/$7,50 entra in vigore il **1° gennaio
2027**. Il commento nel file lo dice ("post-intro standard rate"), quindi fu una scelta, non un
refuso — ma la conseguenza è che ogni riga `gemini` in `ai_calls` costa **il doppio del vero**, e
la dashboard dei costi sbaglia di 2× su 13.265 chiamate in 30 giorni.

Non lo tocco qui: cambiare quella tariffa cambia i crediti addebitati agli utenti, ed è una
decisione di prodotto. Ma va deciso, perché finché resta, ogni confronto di costo fra provider
parte da un denominatore sbagliato — incluso quello che ha motivato questa PR.
