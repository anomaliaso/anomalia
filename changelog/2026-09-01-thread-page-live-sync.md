# La pagina del thread guarda di nuovo fuori da sé

Un render `motion_video` è girato per dieci minuti su un thread aperto davanti al proprietario, e
la riga «lavoro in background» non è mai comparsa. Il lavoro c'era, il job batteva ogni dieci
secondi, il partial si aggiornava. A mancare era chi lo chiedesse.

## Cosa era rotto

**Il ricontrollo stava in un posto solo.** Il fetch di `pending_tools=1` che accende
`watchToolJobs` — e con lui `ChatBackgroundJobs` — viveva in fondo a `send()`, dopo il ramo
felice. `result === 'error'` e `result === 'cancelled'` tornano indietro una decina di righe
prima: uno stream che si spezza, o lo Stop, escono da lì e quel fetch non parte mai. Da quel
momento nessuno chiede più niente — il seed di `+page.server.ts` è la fotografia della load, e il
solo `visibilitychange` della shell rinfresca i crediti.

**La pagina del thread non aveva sincronia viva.** `ChatColumn` — l'altra superficie della stessa
chat, quella del workbench — si riaggancia da sempre a `thread-changed` e rifà il transcript.
Qui c'era solo `thread-seq`, che muove la proiezione degli eventi e non tocca i messaggi. Il turno
di rientro di un lavoro in background lo scrive il worker della coda, senza SSE in questa scheda:
atterrava nel database e a schermo restava la conversazione di prima finché non si ricaricava a
mano. Le due metà insieme davano il caso peggiore — nessun segnale che il lavoro girava, e nessun
segnale quando finiva.

Non era RLS né ownership: `chat_jobs_select` è `brand_id IN auth_brand_ids() AND user_id =
auth.uid()`, e la riga era del proprietario del thread. La query sarebbe tornata piena. Non l'ha
fatta nessuno.

## Cosa cambia

`checkPendingTools()` esce da `send()` e va in `lifecycle.svelte.ts`, dove le altre decisioni del
ciclo di vita sono già testabili senza montare la pagina. Da lì la chiamano tutti i punti dove la
domanda ha senso: la fine di ogni turno — felice, fermato o rotto —, un `thread-changed` sul
thread aperto, e il ritorno del focus. La guardia `io.loading()` sta dentro la funzione, così
nessun chiamante può dimenticarla.

La pagina prende il `onThreadChanged` che `ChatColumn` ha sempre avuto: il server notifica, il
transcript si rifà dall'endpoint autorizzato, quindi niente di quello che arriva dal canale viene
creduto sulla parola. Il `visibilitychange` copre il caso che il canale non copre: un socket
caduto a scheda nascosta, che è esattamente quando l'utente se ne va a fare altro aspettando un
render.

**Scartato:** avvolgere `send()` in un `try/finally`. Copriva gli stessi tre rami con meno righe,
ma spostava il ricontrollo dopo il `busy`/`busy_saved` — dove nessun lavoro può essere partito — e
rendeva il diff illeggibile su una funzione lunga duecento righe. Scartato anche far tornare
`pending_tools=1` anche i `chat_response`: la riga «lavoro in background» comincerebbe a contare
il turno stesso che la sta disegnando.

## Perché il test è dove è

`lifecycle.test.ts` è nuovo e prova il comportamento — che il watcher si accenda con un lavoro
vivo, che stia zitto con la lista vuota, che non chieda niente a turno in corso, che un endpoint
rotto non faccia saltare il chiamante. Il resto è nel `shell.test.ts` che questa pagina ha già:
tre pin sul sorgente perché la sincronia non torni a esistere in un ramo solo. Sono pin, non
prove — è per quello che ci sono anche i primi.
