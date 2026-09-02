# Auto, Fast e Pro non erano modelli

Erano alias per due variabili d'ambiente. `auto` e `fast` risolvevano entrambi su
`LLM_DEFAULT_MODEL` — cioè erano lo stesso modello con due nomi — e `pro` sul **secondo elemento**
di `LLM_MODELS`, scelto per posizione in una lista separata da virgole. Tre voci nel menu per due
valori, nessuno dei due toccabile senza un deploy, e `fast` che non era distinguibile da `auto`
nemmeno volendo.

Adesso una scelta è un id del gateway e basta. Chi non sceglie prende il default, e la scaletta ha
tre gradini e nessun preset dentro:

```
1. il modello scelto nel prompt input   → chat_threads.model        (per chat)
2. il default del brand                 → brands.chat_default_tier  (Settings)
3. il default globale                   → chat_model_catalog.is_default  (Supabase)
```

## Cosa è stato tolto, e cosa costa

**L'escalation Auto→Pro.** Una richiesta di produzione («crea un carosello») alzava il tier a
`pro`. Senza un `pro` non c'è niente su cui alzare. Il classificatore `isHeavyProductionAsk` resta
— l'harness lo usa per decidere quali strumenti mettere sul tavolo — ma non sceglie più il
modello, e un test lo pinna perché non torni la scalata silenziosa.

**La policy di modello degli agenti di sistema** (`modelPolicyForAgent`). Il motion specialist
imponeva Grok. Ora ogni agente parte sul default. **Questo ha un prezzo noto**: il 26/8
`glm-5.3-flash` ha girato 23 minuti su un brief di composizione senza scrivere una riga di
sorgente, e il preset Pro era quello che lo evitava. L'unica cosa che resta fra un default veloce
e quei 23 minuti è `MOTION_VIDEO_MODEL`, la scappatoia esplicita — che ora è l'unica difesa, non
una seconda. Il test in `motion-video/model.test.ts` lo dice per esteso.

**Il parametro `tier` di `harnessSdkModel`.** Risolveva sempre la stessa cosa: un parametro che
non distingue niente è solo un posto dove sbagliare.

**Le famiglie Luna e Grok come tier ripristinabili.** Una riga salvata che nomina solo la famiglia
non sa più dire *quale* modello: torna `null` e la chat riparte dal default, invece di scegliere
per conto dell'utente. Le righe con un `model` esplicito si ripristinano come sempre.

## Il difetto trovato provandolo

La prima verifica nel browser è andata storta nel modo giusto: riga marcata su `z-ai/glm-5.3-flash`,
turno girato su `google/gemini-3.8-flash`, `ok=true`, nessun errore. `resolveChatModel` è sincrono
— lo chiamano una dozzina di superfici che poi fanno `streamText`, e renderlo asincrono
propagherebbe un await fino a ognuna — quindi legge una cache di modulo, e su quel percorso nessuno
l'aveva scaldata.

Scaldarla «nel primo chiamante che capita» non è una soluzione: il default lo cambia l'operatore da
fuori, e un valore così non può dipendere da chi è passato di lì prima. La scalda
`hooks.server.ts`, prima di ogni handler — una query al minuto per istanza, e nessun percorso che
possa leggere un catalogo mai caricato. La lezione sta in [`LESSONS.md`](../LESSONS.md).

## Il vincolo che rendeva scomodo il gesto per cui esiste

«Un default solo» era un indice unico parziale. Viene valutato riga per riga, e faceva fallire
l'UPDATE più naturale che si possa scrivere — `set is_default = (model_id = '…')` — cioè la spunta
in Supabase Studio. Ora è un trigger: chi accende un default spegne gli altri, in un solo
statement. Non ricorre, perché l'UPDATE interno scrive `false` e la clausola `WHEN` vuole `true`.

## Verificato

Stack locale, brand `demo`, utente `test@anomalia.so`, browser reale. Il picker non offre più
Auto/Fast/Pro e apre su «Default · <nome del modello>». Svuotato l'override del brand dai Settings,
`brands.chat_default_tier` va a `null`. Spostata la riga marcata su `z-ai/glm-5.3-flash` mentre
`LLM_DEFAULT_MODEL` restava `google/gemini-3.8-flash`: il turno è girato su glm — `ai_calls`
registra `llm/z-ai/glm-5.3-flash`, `ok=true`. Suite intera verde (6243).
