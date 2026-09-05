# Il parametro `ai` sparisce dalle firme

Ogni funzione che generava testo o immagini prendeva come primo argomento un
`ai: GoogleGenAI`. Nessuna lo leggeva. `genaiClient()` tornava `null as never`,
e i due sink — `aiText` e `aiStructured` — lo ricevevano come `_ai` e
instradavano da soli, dal centralino kie o dal gateway. Lo stesso valeva per
`groundedText`, che la risposta la prende dai provider web.

Il censimento prima di togliere una riga: 52 firme, ~132 punti di chiamata, 61
file non di test. Zero costruzioni di un client vero — nessun `new GoogleGenAI`,
nessun `googleGenaiClient(` — quindi il parametro era morto ovunque e rimuoverlo
non cambia comportamento. È la ragione per cui questo lotto non porta test nuovi:
i test che contano sono quelli che c'erano già, e sono verdi.

Tre fabbriche di `null` alimentavano quei call site: `genaiClient()` in
`brand-context.ts`, un omonimo dentro `ugc-batch.ts` e `client()` in
`content-preview/plan-pipeline.ts`. Le ultime due spariscono con i loro
chiamanti: togliere il parametro lasciando la sorgente del `null` avrebbe curato
il sintomo e tenuto la causa.

Un ramo era morto per davvero, non solo inerte. `extractAnnouncements` sceglieva
`aiStructured` quando `ai` era valorizzato e `llmStructured` altrimenti — ma
`runBrandAnalysis` costruisce quel client come `genaiClient || (null as never)` e
nessuno dei tre chiamanti passa niente. Il ramo `aiStructured` non era
raggiungibile: è uscito insieme al parametro.

## Cosa resta, e perché

`geo.ts` non è toccato se non in tre posizioni di argomento. Il file sta per
essere riscritto altrove (nuovo roster dei motori GEO) e le due firme dove `ai`
non era il primo argomento — `groundedAnswer(engine, ai, query)` e
`auditOnePrompt(engine, ai, brandName, p)` — cadono con quella riscrittura, non
con questa. Qui si toglie solo l'argomento dove `geo.ts` chiama lo spine
condiviso (`structured`, `groundedGemini`), perché cambiare l'arità di funzioni
usate da altri tredici file rompeva la compilazione di `geo.ts` e basta: era
quello o lasciare intatta la parte più grossa del lavoro.

Per la stessa ragione `@google/genai` **resta** in `package.json`. Verificato col
grafo reale al momento di chiudere, non col piano: `google-models.ts` — che era
`gemini.ts` e che il censimento sospettava — non lo importa affatto. Gli unici
due importatori rimasti sono `geo.ts` e `brand-context.ts`, che tiene in vita
`genaiClient()` solo perché `geo.ts` lo consuma via il re-export di
`research.ts`. Quando la riscrittura GEO atterra, quei due cadono insieme e la
dipendenza esce con la PR che arriva seconda.

`groundedGemini` resta in `research.ts` per lo stesso motivo, e non perché sia
viva: l'unico chiamante è `geo.ts`. Diventa senza chiamanti solo quando la
riscrittura GEO è dentro, ed è lì che va tolta — toglierla adesso vorrebbe dire
entrare nel corpo di `groundedAnswer`, cioè esattamente il perimetro che quella
riscrittura sta rifacendo.
