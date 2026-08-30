# Un turno morto si riprende, invece di essere ucciso

Chiedi "sistema tutti e 10 gli articoli". L'agente ne fa quattro, poi la piattaforma chiude
l'invocazione — c'è un tetto di durata, oppure esce un deploy. Il reaper se ne accorgeva e
faceva l'unica cosa che sapeva fare: **abortiva** il run e promuoveva il parziale a
messaggio. Metà lavoro in chat, la conversazione ferma, e nessuno a dire che manca il resto:
se ne accorgeva l'utente, o non se ne accorgeva nessuno.

Il metro resta la chat di [rakazo](https://github.com/elie222/rakazo): da loro un run il cui
worker muore viene **ripreso** da un altro con un fence nuovo, non chiuso.

## Perché il gate della ADR 0002 si è aperto

La [0002](../docs/adr/0002-defer-distributed-run-leases.md) rimandava i lease "finché worker
indipendenti non devono riprendere lo stesso run". Sembrava una condizione lontana. Non lo
era: **un turno gira già in due posti** — la richiesta che lo streamma e il drain della coda,
che chiamano entrambi `runKitTurn` — e con il log durevole della
[0003](../docs/adr/0003-durable-thread-event-log.md) il browser non deve più essere quello
che riceve un turno perché il turno si veda. Un run che sopravvive alla sua invocazione è il
caso ordinario, non un'ipotesi distribuita.

## Il lease, e cosa regge davvero

`agent_kit_claim_run` prende un run libero (`queued`, `waiting_input`, `waiting_takeover`)
**oppure** uno `running` col lease scaduto, e nello stesso statement incrementa `lease_fence`
e `attempt`. Ogni scrittura che può corrompere il turno — la chiusura col messaggio, il
rinnovo, il battito che lo specchio dello stream scrive — è recintata da `(owner, fence)`.

**A reggere è il fence, non l'abort.** Un processo ucciso dalla piattaforma non riceve
nessun segnale: interrompere la chiamata al modello quando il rinnovo fallisce serve a un
worker ancora vivo che ha solo perso la corsa. L'unica cosa che impedisce a un morto di
scrivere è la `where` recintata. Il test che lo pinna si chiama *"LO ZOMBIE NON CHIUDE"*.

## La strada scartata, e perché era peggio

Il primo disegno lasciava il reaper abortire e salvare il parziale, **e in più** accodava una
continuazione con un prompt sintetico ("riprendi da dove eri"). Tre effetti insieme: in chat
restavano il mezzo messaggio salvato **e** la risposta prodotta dalla ripresa. Il ledger
degli effetti impedisce di rifare le scritture esterne, non di lasciare due bolle. E il
prompt sintetico è un ri-orientamento lossy: il modello rilegge e può rifare.

Ora il reaper **lascia la riga `running` col lease scaduto** — è esattamente ciò che permette
la presa successiva — e accoda un lavoro che porta l'id del run. Il drain lo riprende col
fence dopo, e continua lo stesso turno. Il parziale si salva **solo** sul ramo della resa,
dopo `MAX_RUN_ATTEMPTS`, che è quello che il reaper ha sempre fatto.

Il ledger degli effetti si riconcilia **prima** di entrambi i rami: è lui, non il lease, a
impedire che una ripresa ripeta una scrittura che il segmento morto aveva già iniziato.

## Cosa NON si porta dal metro

- **L'elezione per advisory lock.** Il loro reconciler tiene un `pg_try_advisory_lock` su una
  connessione che vive fra i tick; su serverless quella connessione muore con l'invocazione.
  Non è irrealizzabile, è **inutile**: il cron è già l'unico esecutore per tick.
- **Il rinnovo illimitato.** Un run più lungo della durata massima di un'invocazione non si
  tiene in vita rinnovando: va affettato e ripreso. Il TTL del lease è dimensionato su
  *quanto può legittimamente durare un'invocazione*, mai su quanto dura il compito. È il
  residuo vero del serverless, e nessun fence lo cancella.

## L'ordine di rilascio, che qui non è un dettaglio

I deploy di questo repo **non applicano le migration**, quindi fra l'applicazione della 0229
e il deploy del codice c'è una finestra in cui la produzione chiama ancora la vecchia firma.
Perciò `p_owner`/`p_fence` hanno un default e il recinto vale solo quando il lease c'è: la
chiamata a cinque argomenti continua a risolvere. La vecchia firma viene eliminata — tenerle
entrambe la renderebbe ambigua (`function is not unique`) e romperebbe ogni chiusura.
Renderli obbligatori è una migration successiva, dopo il deploy.

E il reaper legge con `select('*')`: nominare `attempt` in una select prima che la migration
sia applicata dà 42703, che supabase-js non alza — avrebbe spento il reaper in silenzio.
