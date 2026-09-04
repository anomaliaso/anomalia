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

## `SERVED_BY`: una coppia senza trasporto non è una rotta

Aggiungere `openrouter` rendeva analizzabile anche `AI_ROUTE_TEXT=gemini@openrouter` — ma
`geminiTransport()` conosce solo `kie` e `google`, quindi quella rotta sarebbe atterrata **in
silenzio su Google**. È il guasto peggiore della famiglia: la rotta si legge come rispettata, il
traffico va altrove, e non resta traccia da nessuna parte.

La prima versione di questa PR lo segnalava nel corpo della PR. Non regge, per due motivi:

- **un avviso in una PR non sopravvive.** Fra due settimane qualcuno legge il registro, vede
  `openrouter` fra gli endpoint validi, imposta la variabile e ottiene Google. È lo stesso
  meccanismo del commento scaduto che AGENTS.md vieta: la conoscenza fuori dal codice invecchia e
  mente.
- **il registro ha già la regola giusta.** Quando manca la chiave, *«un endpoint senza chiave non è
  una rotta: si ripiega, rumorosamente»*, e un test lo tiene. Un endpoint senza **trasporto** non è
  più una rotta di uno senza chiave.

Quindi quella conoscenza è diventata una tabella, `SERVED_BY`, accanto alle altre quattro: quali
endpoint hanno davvero un trasporto scritto per ogni famiglia. `route()` ora ha due modi di
rifiutare, entrambi rumorosi, e il messaggio dice **quale** dei due: `nessun trasporto gemini verso
openrouter` oppure `la chiave manca`.

Il buco **non era nuovo**: valeva identico per `gemini@xiaomi`, `gemini@deepseek`, `mimo@kie` e ogni
altra coppia mai collegata. Chiuderne uno solo — quello appena visto — avrebbe garantito il ritorno
degli altri, ed è esattamente la "condizione sparsa" che AGENTS.md vieta: le eccezioni si dichiarano
**in un posto solo, accanto al modello che le governa**. Il test le percorre tutte e quattro.

Quella conoscenza viveva sparsa in tre file (`gemini.ts`, `xiaomi.ts`, `gemini-audio.ts`), dove
nessuno poteva vederla tutta insieme. Il giorno che si collega il trasporto del testo verso
openrouter, cambia **una riga** di questa tabella e il test cambia colore.

## Quello che NON è in questa PR, e perché

- **Il trasporto del testo verso openrouter.** È la PR successiva. Finché non esiste, il registro
  rifiuta la rotta rumorosamente invece di fingerla — vedi sopra.
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

## Il default gira: le immagini vanno su OpenRouter

La ragione **non è il costo**. È il p95.

| | chiamate | fallite | media | p95 |
|---|---|---|---|---|
| Google | 993 | **0** (0,0%) | 9,2s | 20,2s |
| kie | 199 | 7 (**3,5%**) | 68,1s | **142,9s** |
| OpenRouter | misurato | — | **3,4s** | — |

Un render su kie può far aspettare **due minuti e mezzo**, e uno su ventinove non arriva affatto.
OpenRouter è tre volte più veloce di Google e venti volte più di kie, ed è sincrono.

Il prezzo, rifatto sul mix vero invece che sul confronto sbagliato — il +68% girato in giro
confrontava OpenRouter con **kie**, ma l'83% dei render gira su **Google**:

| modello | Google (produzione) | kie (produzione) | OpenRouter (misurato) |
|---|---|---|---|
| Nano Banana 2 — 71% dei render | $0,06891 | $0,05797 | **$0,06721** |
| Nano Banana 2 Lite | — | $0,02000 | $0,03361 |
| Nano Banana Pro | $0,11939 | $0,09000 | $0,13525 |

Sul modello che porta il 71% dei render OpenRouter costa il **2,5% meno di Google**. Sul totale
sono **+$13,17 al mese** (+17%), non +68%.

### Due ruoli che non vanno confusi

`SLOT_DEFAULT.image` è openrouter, ma `HOME['nano-banana']` resta **kie**. Non è una svista: il
default dice dove va il traffico quando tutto funziona, `HOME` dove va quando openrouter non è
utilizzabile. Facendoli coincidere il ripiego finiva su **Google saltando kie**, cioè l'opposto di
«kie resta il ripiego». Un test lo tiene.

### La variabile che deve cambiare a mano, o il deploy non sposta niente

`IMAGE_PROVIDER=gemini` è impostata in produzione — è il motivo per cui 993 render su 1.192 girano
su Google invece che sul default kie di prima. La vecchia variabile **batte** `SLOT_DEFAULT`,
quindi da sola questa PR non muove un solo render.

Serve una di queste due, su Vercel:

    AI_ROUTE_IMAGE=nano-banana@openrouter     (batte entrambe, reversibile in una variabile)
    oppure togliere IMAGE_PROVIDER

La prima è preferibile: è additiva, non cancella l'interruttore di emergenza, e si annulla
rimuovendola. Un test copre esattamente questo caso, perché era il modo più facile di credere che
il cambio fosse fatto quando non lo era.
