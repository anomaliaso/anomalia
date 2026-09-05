# Le porte laterali verso i fornitori, chiuse — e una guardia che morde

`Endpoint = 'kie' | 'openrouter'` (PR #335) aveva sistemato il registro, cioè la
porta principale. Restavano le porte laterali: quattro moduli che si costruivano
un client per conto loro, saltando il registro. Il censimento dei 29 chiamanti li
ha divisi in due — 26 importavano **costanti e tipi**, 3 costruivano **client** —
ed è la distinzione che ha reso la cancellazione sicura invece che veloce:
cancellare una costante ancora usata rompeva il build in venti punti.

## Cosa parlava davvero con Google

Solo `gemini.ts` costruiva un `new GoogleGenAI`. `people.ts` e `research.ts` lo
importavano come *valore* usandolo solo come tipo. Da lì partivano tre strade, e
solo due erano vive:

- **`people.ts` — viva, ed era un difetto.** La generazione degli avatar chiamava
  `ai.models.generateContent` con `gemini-3.1-flash-lite-image` scritto a mano,
  su un client che `makeGenaiClient()` risolveva su **Google** ogni volta che la
  rotta del testo non era `gemini@kie` — cioè sempre, essendo il default
  `gemini@openrouter`. Era l'unica immagine del prodotto che non passava dallo
  slot immagini, e nessuno l'aveva deciso. Ora passa da `renderPostImage` come
  ogni altro render: il modello lo sceglie il registro. Il modello *risultante*
  non cambia — `gemini-3.1-flash-lite-image` è l'id Google dello stesso Nano
  Banana 2 Lite che lo slot serve di default — cambia chi lo serve.
- **`blog-month.ts` — viva sulla carta, mai percorsa.** La Batch API di Google,
  a metà prezzo con SLA 24h, difesa da un commento che la diceva insostituibile
  («kie non ha una batch API»). `blog_month_jobs` ha **0 righe da sempre**, in
  entrambe le modalità: era uno sconto su un traffico che non esiste, e teneva in
  vita l'ultima ragione per cui `google` restava raggiungibile. Via la modalità
  `batch`; resta `fast`, che rende in linea dallo slot immagini. La conseguenza
  di prodotto: non ci sono più due velocità, quindi la *fast generation* non è
  più un perk del piano Pro — c'è una velocità sola, per tutti.
- **Il ramo Google di `renderPostImage` — irraggiungibile.** Dopo i due `if` su
  `route('image').endpoint`, che coprono `'kie' | 'openrouter'` per intero, c'era
  ancora `googleGenaiClient()`, `MAX_IMAGE_ATTEMPTS = 3` e la logica del
  ritentativo sulla risposta vuota di Gemini. Chi leggeva quel file credeva che
  le immagini potessero ancora andare su Google.

## Il commento che mentiva, e i test che lo credevano

Sopra quel ramo c'era scritto: *«`AI_ROUTE_IMAGE=nano-banana@google` riporta
tutto su Google senza deploy»*. Non è vero da PR #335: `parseRoute` rifiuta
`google` e cade sul default. Era un interruttore d'emergenza documentato che non
esiste — e qualcuno lo avrebbe cercato proprio nel momento in cui serviva.

Peggio: **due test lo credevano.** `craft-floor.test.ts` e
`one-render-per-image.test.ts` finivano `route` a `{ endpoint: 'google' }` e
contavano le chiamate a `googleGenaiClient`. Verificavano il pavimento del design
e il conteggio dei render **su un ramo che la produzione non poteva raggiungere**.
Passavano, ed è la cosa peggiore: un test che non può fallire non è una rete.
Riscritti sul percorso vero (kie), continuano a passare — ma ora misurano.

## `xiaomi.ts` era il centralino del testo con il nome di un fornitore addosso

Nessuno dei suoi 14 importatori toccava Xiaomi: importavano `aiStructured`,
`aiText`, `parallelVariants` e delle costanti. Il trasporto MiMo era morto **per
tipo**:

```ts
export const AI_PROVIDER =
  TEXT_ROUTE.provider === 'kie' && TEXT_ROUTE.family !== 'gemini' ? 'kie' : 'gemini';
```

`AI_PROVIDER` non può valere `'xiaomi'`. Eppure quattro rami lo confrontavano con
`'xiaomi'`: sempre falsi, mai visti fallire, in tre file diversi — più un commento
in `recommend-platforms/+server.ts` che documentava `AI_PROVIDER=xiaomi` come
modalità veloce, mandando chi lo leggeva a impostare una variabile inerte.

`AI_PROVIDER` faceva due danni in una riga: **ricollassava i due assi del
registro** — famiglia ed endpoint — che la testata di `model-routing.ts` vieta
esplicitamente, e il suo valore diceva una famiglia (`'gemini'`) per significare
un endpoint (il gateway). Il commento accanto lo confessava. Non è stato
sostituito da un'altra costante derivata: chi ha bisogno della rotta la chiede al
registro **nel punto in cui gli serve** (`textGoesToKie()`, letta a ogni
chiamata). Una foto scattata al caricamento del modulo invecchia e mente: è così
che ci siamo arrivati.

Il modulo si chiama `ai-text.ts`. `PIN_GEMINI` → `PIN_GATEWAY` (31 call site):
terzo nome in tre giri, e ogni volta per lo stesso motivo — `DEEPSEEK_FIRST`
prometteva DeepSeek dopo che DeepSeek era uscito, `PIN_GEMINI` prometteva Gemini
quando ormai significava "il gateway".

## DeepSeek: misurare non è generare

Due usi, due destini opposti, e confonderli era il rischio.

Il **ripiego di grounding** in `research.ts` faceva scrivere la risposta a un
modello DeepSeek: è generazione, ed è uscito. La catena ora è Exa → Tavily.

La **sonda di citazioni** resta. `geo.ts` chiede alla ricerca di DeepSeek "questo
brand è citato?" e conta la risposta: il motore misurato *deve* essere quello
vero, non c'è modo di misurarlo attraverso un gateway. Sta dall'altra parte del
vetro come `exa`, `dataforseo` o `scrapecreators`. Il file si chiama
`citation-probe.ts`, perché chi lo rileggesse fra sei mesi vedrebbe altrimenti un
fornitore che credevamo di aver tolto.

## La guardia, e perché è assoluta

`no-side-doors.test.ts`: nessun file sotto `src/` importa lo SDK di un fornitore
**come valore**. `import type` passa — sparisce alla compilazione e non costruisce
niente. `@ai-sdk/openai` non è nella lista: è la *forma* OpenAI-compatibile, e la
usano entrambi gli endpoint vivi. Il vincolo è il fornitore, non il protocollo.

Nessuna lista bianca, **nemmeno per `gemini.ts`**. Una guardia con un'eccezione si
allarga di un file alla volta, ed è esattamente così che questo confine si era già
svuotato.

**È stata vista fallire prima di essere scritta verde**, e tre volte:
sull'albero di partenza (nominava `gemini.ts`, `people.ts`, `research.ts`), con
un import fasullo iniettato in un file pulito, e di nuovo sull'albero finale.
Il secondo test del file protegge la guardia da sé stessa: la regex deve
riconoscere un import di valore e lasciar passare uno di solo tipo — una regex
che smette di riconoscere non fallisce, *passa*, ed è così che un confine muore
senza rumore.

## Il resto

- `structuredXiaomi`, `textXiaomi`, `XIAOMI_BASE_URL`, l'interruttore sul modello
  morto: via, nessun chiamante.
- `genWithRetry`, `loggedGemini`, `extractGeminiUsage`, `extractXiaomiUsage`: zero
  chiamanti dopo la chiusura del ramo Google.
- `DEEPSEEK_PRO_MODEL`: definita, letta da nessuno. Il catalogo chat continua a
  offrire `deepseek-v4-pro` con un `wireId` suo, e `servableWireId` lo risolve
  solo se il gateway lo serve davvero — non è una porta.
- `RATES`: via le tre righe MiMo (il trasporto non esiste, nessuna riga nuova può
  nominarle). `deepseek-v4-flash` **resta**: la sonda di citazioni la scrive
  ancora. `cost_usd` è scritto una volta sola e la fatturazione somma la colonna,
  quindi togliere una tariffa non tocca le righe storiche.
- `.env.example`: via `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `XIAOMI_MIMO_API_KEY`,
  `XIAOMI_MODEL`, `XIAOMI_VISION_MODEL`, `DEEPSEEK_PRO_MODEL`. `GEMINI_TRANSPORT`
  **resta**: `model-routing.ts` la onora ancora per il valore `kie`.
- `ModelFamily` non ha orfani: ogni famiglia ha ancora un trasporto in `SERVED_BY`.
- `['AI_PROVIDER', 'xiaomi']` in `RETIRED_LEGACY` **resta**, ed è la distinzione
  che conta: la costante derivata va via, l'interruttore vecchio deve continuare a
  dire no rumorosamente a chi ha ancora la variabile impostata in produzione.

## Quello che il cruscotto dirà comunque

`main` è ~400 commit dietro `dev`: il `dev → main` non è mai stato fatto. In
`ai_calls` degli ultimi dieci giorni ci sono righe su percorsi che **in `dev` non
esistono più** — `renderPostImage`/`gemini` (77 il 4 settembre),
`critiqueImage`/`xiaomi` (8), etichette come `critiqueImage` che nel sorgente non
compaiono più nemmeno come funzione. Sono la produzione che gira codice vecchio.

Dopo questa pulizia il cruscotto continuerà a mostrare righe `gemini` e `xiaomi`,
e **non vorrà dire che la pulizia è fallita**. È il tipo di osservazione che fa
revertire un lavoro giusto.

## Il ciclo che la cancellazione ha fatto cadere

Tolto `genWithRetry` (zero chiamanti), il server ha smesso di partire: `circular dependency` su
moduli non toccati. Il ciclo era già lì — `images → blog-site → referrals → crediti → scheduler →
director → content-preview → images` — e restava in piedi solo grazie all'ORDINE in cui i moduli
si inizializzavano, che l'import alla riga 2 di `images.ts` teneva fermo.

Tagliato dove il pezzo condiviso non ha dipendenze: `firstLogoUrl`, cinque righe pure che leggono
il primo logo di un array, viveva dentro il blog pubblico intero (Marked, client admin, referral)
ed era importata da lì dal renderer delle immagini. Ora sta in `$lib/brand-fields.ts`, il foglio
senza import fatto per esattamente questo. Sta in LESSONS.md, perché la classe di guasto conta più
del caso: **un ciclo che regge per ordine di inizializzazione è già rotto, e non te l'ha detto.**

Da notare quale controllo l'ha preso: `npm run dev` sulla rotta vera. I 7.289 test erano verdi e
`svelte-check` muto.

## Quello che non è stato fatto

Il parametro `ai` di `renderPostImage` / `renderBrandImage` / `renderCarouselSlide`
e delle funzioni di `research.ts` è morto — nessuna lo legge, e `media-generate.ts`
gli passava già `null as never`. Toglierlo sono ~20 call site di pura meccanica:
è un lotto a parte, non una porta. `brand-context.genaiClient()` resta come unico
segnaposto di quel parametro, ma non costruisce più niente e lo dice.
