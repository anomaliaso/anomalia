# Le immagini allegate non raggiungevano il modello sui turni ricostruiti dalla history

La PR #24 aveva sistemato il primo invio: l'immagine viaggia come data-URL, una
stringa, e attraversa indenne ogni trasformazione fino a `extractUserImages` del
patch pi. Ma sui turni RICOSTRUITI dalla history — redo, retry di un turno morto,
continuazioni di obiettivo e anti-ripetizione — `messagesFromRow` produce parti
immagine con `image: new URL(...)`, un OGGETTO. `stripProviderRefs` (live.ts) ricostruiva
ogni oggetto con `Object.entries`, che per un `URL` restituisce `[]`: la parte
arrivava all'adattatore come `image: {}`, veniva scartata in silenzio, e il modello
riceveva solo il testo `[attached: <url>]` — rispondendo di non vedere l'immagine.
Prova di produzione: reasoning del 28/8 18:05 UTC («They attached an image via URL…
I don't actually perceive any image content»), 5 minuti prima della task #57.

Riproduzione deterministica (`scripts/debug/pi-kit-image-loop.mjs`, harness pi reale
+ OpenRouter vero): URL oggetto senza strip → l'immagine arriva; URL oggetto con
`stripProviderRefs` → 3/3 turni senza immagine nel body, «Non vedo alcuna immagine».

Fix: `stripProviderRefs` estratto in `provider-refs.ts` (modulo puro, testabile senza
tirarsi dietro `live.ts`) con la conservazione degli `URL` — serializzati come stringa
https che `extractUserImages` scarica — e unit test sulle parti multimodali
(`provider-refs.test.ts`, rosso→verde). Lezione in LESSONS.md: la PR che dice
«risolto» era verificata solo sul primo invio, non sul redo.

## Il crash del secondo turno (stessa sessione di diagnosi)

Il giorno stesso, il run c0c11b3d (agente content, glm su openrouter) moriva a fine
turno con «HarnessAgent: received terminal finish with unclosed step content»: la
chain è `finish()` dell'harness che lancia quando lo step non è chiuso → `fail()` →
`result.steps` rigettato → `handleFinish` catch → «Errore del turno» salvato in chat.
La forma: `stopReason 'error' | 'aborted'` in pi-agent-core emette `turn_end` col
messaggio che CONTIENE ancora la tool call mai eseguita; l'adattatore aggiunge gli id
ai `pendingStepToolCallIds`, `finishStep` resta muto (`size > 0`), e il `finish`
terminale dopo `session.prompt` trova lo step aperto.

Il contratto dell'harness è esplicito («adapters must emit `finish-step` before
`finish`»): il patch ora chiude lo step aperto (finish-step con unified `"other"`,
unico valore onesto nell'enum) prima del `finish` terminale e prima dell'emissione
d'errore — no-op quando lo step è già chiuso. Verificato coi tre scenari del loop
(errore dopo toolcall, socket cut, turno sano) e dalla suite bridge (118 verdi).
