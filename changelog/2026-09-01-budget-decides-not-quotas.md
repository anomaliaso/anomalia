# Il budget decide, e i prezzi vengono da un posto solo

Il volume di una settimana lo decidevano tre soffitti impilati, nessuno derivato da
quello che il brand paga: l'enum delle cadenze, un tetto di 14 post a settimana scritto
a mano, e la quota di post. Peggio: erano legati fra loro, perché il prompt del piano
imponeva che il `content_mix` sommasse alla cadenza. Un tetto sul ritmo era quindi un
tetto sul volume, e un Pro che paga 90 post al mese ne vedeva pianificati 28.

Ora non c'è nessun numero scritto. Il piano riceve **i crediti della settimana e il
listino**, e dimensiona il mix su quello che comprano — «una settimana con una lunga
storia illustrata e due post corti può valere più di sei post intercambiabili» — mentre
il gate di fattibilità rifiuta un batch che non si può produrre. La cadenza torna al suo
mestiere: come la settimana è sparsa sui giorni, mai quanta ce n'è. E non è più gated
dal piano, perché limitare il ritmo non protegge più niente da quando il volume non ci
pende sopra.

**I crediti dei piani derivano dal prezzo.** Erano tre cifre a mano — 2100 / 5500 /
12000 — con margini impliciti che nessuno aveva scelto: 28% su Go, 38% su Starter, 47%
su Pro. Ora sono prezzo × (1 − margine), col margine dichiarato una volta (50%, 40% su
Go perché è il piano d'ingresso): **1740 / 4450 / 11250**. La pagina prezzi e
l'entitlement leggono lo stesso campo, e un test li tiene insieme — cambiare un prezzo
senza i crediti fallisce invece di mostrare al cliente un numero e concedergliene un
altro.

**E i prezzi vengono da un posto solo.** `plans.ts` aveva la sua tabella (video $0.41,
immagine $0.184) su cui erano dimensionate le quote; nessuna delle due cifre era
misurata. `mixCostUsd` ora chiede a `content-cost.ts`.

**Quello che quella misura rivela, e che resta da decidere:** un mese del mix costa il
**7-9%** dei crediti di un piano, non il ~33% che la vecchia tabella lasciava credere.
La quota di post è circa dodici volte più stretta del budget, e le due non sono mai
state riconciliate perché i prezzi sbagliati nascondevano lo scarto. Togliere la quota
del tutto — «il budget è il limite» — moltiplicherebbe la spesa fino a quel fattore: è
una decisione di listino, non di codice, e va presa guardando questi numeri.

Chiuso anche un guasto che rendeva tutto questo teorico: `generateObject` e
`generateText` non avevano scadenza, quindi una chiamata appesa non tornava mai e la
pagina che l'aspettava nemmeno. Ora scadono.

**E una diagnosi sbagliata, corretta due volte prima che facesse danni.** Avevo concluso
che il modello di default (`z-ai/glm-5.3-flash`) fosse rotto in modalità strutturata: un
test con `curl` in `response_format: json_schema` strict rispondeva 200 e restava aperto
180 secondi con soli spazi. Ma l'app non usa quel percorso, usa l'AI SDK — e lì il
modello risponde. Seconda conclusione, «è lento»: anche quella fragile, perché non avevo
controllato il reasoning dei due modelli.

Controllato, il difetto è nostro. `llmStructured` non ha MAI mandato il campo
`reasoning`, e il default non impostato del provider è patologico:

    campo assente (come faceva l'app)   12.134 token di ragionamento   1 elemento su 3 richiesti
    effort low / medium / high             123-214 token               3 su 3

Non è velocità, è **correttezza**: senza istruzioni il modello spende dodicimila token e
restituisce comunque la cosa sbagliata. Su questo modello il reasoning non si può
nemmeno spegnere (`{enabled:false}` → 400, «Reasoning is mandatory for this endpoint»),
quindi ogni chiamata ora dichiara il suo sforzo — `high` di default, abbassabile con
`LLM_REASONING_EFFORT`.

E «ogni chiamata» andava preso alla lettera: la correzione in `llmStructured` copriva metà
del prodotto. I cicli d'agente chiamano `generateText` per conto loro (`harness/run.ts`) e
non passano da lì, quindi il planner settimanale — venti turni di modello di fila, il
percorso dove dodicimila token sprecati per turno si moltiplicano — era rimasto al default
patologico. `llmReasoningOptions` è esportata e il ciclo la dichiara. La lezione qui non è
sul reasoning: è che una correzione «globale» messa in una funzione vale solo per chi quella
funzione la chiama, e va verificato chi non lo fa.

E sotto il reasoning c'era un difetto più banale e più grave, che ha portato fuori strada due
volte. `fetch` di Node chiude il socket dopo 300 secondi di silenzio; un modello che ragiona
manda `200 OK` e poi niente per minuti. Quello che si vede è `terminated` / `ETIMEDOUT`, che
somiglia a un guasto del provider — ed è il motivo per cui prima ho accusato il modello e poi
la mia stessa modifica. `LLM_TIMEOUT_MS` non proteggeva: governava l'abort dell'AI SDK, mentre
a chiudere era lo strato sotto. Ora il client porta un dispatcher i cui timeout di socket
seguono quel valore, e lo stesso vale per `llmChatCompletions`, che accettava un `timeoutMs`
esplicito che il socket ignorava allo stesso modo.

I tempi in quelle prove oscillavano troppo per concluderne altro (glm fra 68s e 113s,
gemini fra 4s e 27s, con OpenRouter che può instradare la stessa richiesta su provider
diversi), e la scadenza resta larga apposta: stretta, trasformerebbe la lentezza in un
guasto — l'errore da cui questa nota nasce.
