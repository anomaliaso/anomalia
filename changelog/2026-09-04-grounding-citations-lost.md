# L'audit GEO misurava la memoria del modello, non il web

`groundedGemini` esiste per una domanda sola: *«il brand è citato nelle risposte di Gemini?»*. È il
motore **nominato** — l'audit GEO lo usa apposta invece del più economico, perché lì conta CHI ha
risposto.

Tornava **zero citazioni**, e il modello rispondeva senza cercare. `ok: true`, testo plausibile,
nessun errore da nessuna parte.

## Dov'era

`llmText({ webSearch: true })` passava il plugin all'AI SDK così:

```ts
providerOptions: { openai: { ...reasoningOptions(), ...{ plugins: [{ id: 'web', engine: 'native' }] } } }
```

`plugins` è un'estensione **di OpenRouter**, non un parametro OpenAI. L'SDK non la riconosce e la
**scarta in silenzio** — e per giunta `@ai-sdk/openai` v4 parla l'endpoint **Responses**. Misurato
intercettando la richiesta in uscita, le chiavi del corpo erano:

    model, input, usage

`plugins: null`. Nessuna ricerca fatta, `annotations` assenti nella risposta, `citations: []`.

Poi il codice leggeva le citazioni da `result.sources`, che l'SDK popola dal grounding dei provider
che conosce: con la ricerca mai avvenuta, quel campo era vuoto per il motivo sbagliato. Due strati
che si coprivano a vicenda, e nessuno dei due rumoroso.

## La prova, prima e dopo

Stessa funzione, stessa domanda, chiamata vera:

| | citazioni | costo scritto |
|---|---|---|
| prima | **0** | nessuno (solo token) |
| dopo | **4** | **$0,031081** |

Il costo è la seconda metà del difetto: le query di ricerca non venivano fatte, quindi non venivano
nemmeno fatturate — la riga sembrava una normale chiamata di testo.

## La correzione

La chiamata con ricerca web si manda **a mano**, come già fa il render immagini su OpenRouter:
`POST /chat/completions` con `plugins` nel corpo, dove il gateway può vederlo. Le citazioni si
leggono da `annotations` — che è dove OpenRouter mette il grounding di Google: **stesse fonti,
altro nome**. Il costo da `usage.cost`.

Il percorso SENZA ricerca resta sull'AI SDK, intatto: lì l'SDK fa il suo mestiere e non c'è niente
da aggirare. Con esso è sparita l'estrazione da `result.sources`, che su quel ramo non poteva
restituire niente.

## Perché non si è provato a farlo dire all'SDK

Un campo che il provider non conosce viene scartato, e non c'è modo di accorgersene dal lato
chiamante: è esattamente la trappola che ha prodotto questo difetto. Mandare la richiesta dove il
suo formato è noto costa venticinque righe e non ha strati che possano ingoiare un campo.

## Nota per chi legge i numeri di prima

Ogni audit GEO eseguito finché questo era rotto ha misurato la conoscenza pregressa del modello, non
il web: i suoi risultati non sono confrontabili con quelli successivi. Non è una regressione
introdotta da un cambio di trasporto — era già così, e si vede solo guardando le citazioni.
