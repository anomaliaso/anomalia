# La manopola dei giudici arriva sul filo, e parla la lingua del gateway

`GEMINI_JUDGE_THINKING_LEVEL` era letta, validata, passata da due giudici
(`ugc-script-review.ts`, `content-preview/caption-quality.ts`) — e buttata via.
`aiStructured` la destrutturava in `thinkingLevel: _thinkingLevel` e non la girava
a `llmStructured`, che mandava sempre e solo il default globale
`LLM_REASONING_EFFORT`. Chi abbassava la manopola vedeva la stessa spesa e le
stesse risposte, senza un errore da nessuna parte: il guasto che non fallisce.

Il test che lo riproduce è in `ai-text.test.ts` (l'opt arriva a `llmStructured`) e
in `llm-reasoning.test.ts` (il valore finisce in `providerOptions.openai.reasoning.effort`,
e senza richiesta resta il default). Entrambi scritti prima della correzione, e
visti fallire.

## Perché il tipo si sposta

`GeminiThinkingLevel` viveva in `gemini.ts` e nominava `thinkingLevel`, il
parametro di Gemini 3.x. Ma nessuna chiamata di questo prodotto manda più quel
campo: passano tutte da OpenRouter, dove si chiama `reasoning.effort` — ed è
esattamente il nome che `llm.ts` usava già per il default globale, e `kie.ts` per
il suo (`KieReasoningEffort`). Due union identiche a tre valori, una col nome di
Google e una col nome di OpenAI, vive nello stesso codice e scollegate.

Ora è una sola, `ReasoningEffort`, e sta in `llm.ts` accanto a
`LLM_REASONING_EFFORT`: il vocabolario del trasporto sta col trasporto.
`judgeThinkingLevel` diventa `judgeReasoningEffort` e si sposta in `ai-text.ts`,
il centralino da cui i due giudici già passano — la manopola accanto alla porta
che apre.

Il nome della variabile d'ambiente NON cambia: è già scritta nella configurazione,
e rinominarla mentre inizia a funzionare sarebbero due cambiamenti in uno.

## `gemini.ts` → `google-models.ts`

Il file non costruisce nessun client Google da quando i due `makeGenaiClient` /
`googleGenaiClient` sono spariti col loro ultimo chiamante. Restava il nome, che
prometteva una linea verso Gemini: la stessa bugia di `xiaomi.ts`, già corretta in
`ai-text.ts`. Il nome nuovo dice di CHI sono i modelli, non con chi parliamo —
perché con Google non parla più nessuno. Dentro restano solo gli id e le tariffe,
che servono al registro di cassa: un modello Gemini si paga anche quando a
servirlo è qualcun altro.

Tolto anche un mock morto in `motion-video/reference-tools.watch.test.ts`, che
sostituiva il modulo con un `geminiTransport` che non esiste più, e la riga
`PREPUBLISH_THINKING_LEVEL` di `.env.example`, che nessuno legge.

## Quello che NON è uscito, e perché

`@google/genai` resta fra le dipendenze. Il grafo dice il motivo, e non è
un'impressione: **19 file di `src/` importano ancora `GoogleGenAI`**, tutti come
`import type` di un parametro `ai` che a runtime vale `null` — `genaiClient()` in
`brand-context.ts` è `return null as never`. Toglierlo vuol dire cancellare quel
parametro da 132 call site in 53 file, che è il lotto che il commento di
`brand-context.ts` chiama già "solo meccanica". Non è questo lotto: mescolarlo qui
renderebbe illeggibile la correzione che conta.
