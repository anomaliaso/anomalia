# Il week planner esce dal framework, primo dei dodici

`packages/agent-*` (105.226 righe), `src/lib/agent` (23.909) e `src/lib/server/chat`
(32.031) sono destinati alla cancellazione: 161.166 righe, circa il 31% del repository.
Le capacità generative restano — produzione di immagini, caroselli, motion e UGC sono il
differenziatore, non la chat. Quindi ogni orchestratore che oggi passa dal framework va
riscritto sopra le primitive che già funzionano, uno alla volta, senza che nessuno se ne
accorga dal lato del cliente.

Questo è il primo. È il week planner, scelto per tre ragioni: un solo punto d'ingresso
(`runWeekPlannerAgent`), un solo chiamante (`planWeekStrategy`), e un risultato che è un
valore di ritorno e non un effetto sparso — `{ strategy, notes, costUsd }`. Su 594 righe
è anche il più piccolo dei due candidati (`produce-agent.ts` ne ha 1.141), e sta sul
percorso critico dell'autopilot settimanale, cioè dove un errore si vede subito.

## Cosa faceva davvero, prima di toccarlo

Il primo lavoro è stato leggerlo per intero e scrivere cosa fa. Il giro è questo:

1. legge il budget del brand in dollari (`fetchUsdBudget`) e lo converte in crediti — il
   brief con cui il modello sceglie il mix, e il gate che rifiuta un batch non producibile;
2. carica in parallelo il piano editoriale attivo e il contesto di fattibilità del batch,
   poi ci innesta il mix della settimana e le rubriche passate dal chiamante;
3. carica i subreddit noti **solo** se reddit è fra le piattaforme;
4. costruisce system e prompt, e apre un giro a strumenti dell'SDK con tetto di 40 step:
   nove letture gratuite dentro il brand, `research` (max 30, a pagamento), `draft_seeds`
   (max 4, ognuna una chiamata a `planStrategy`), `check_batch_feasibility`,
   `repair_seeds` (max 8) e `finish`;
5. a ogni step aggiorna il costo, calcola un'impronta e si ferma se quattro step di fila
   sono identici;
6. `finish` non chiude se i seed violano ancora la fattibilità: restituisce le violazioni;
7. quando il giro finisce senza `finish`, chiude da solo se i seed passano il gate,
   altrimenti esce in ripiego togliendo la storia agli episodi la cui fonte non è ancorata
   a una pagina davvero letta in quel giro;
8. scrive `agent_runs` (stato, note, step, violazioni, costo) e `ai_calls`.

Niente di tutto questo veniva dal framework. Il framework avvolgeva il punto 4.

## Cosa nascondeva `harnessGenerateText`

`harnessGenerateText` chiama `generateText` dell'SDK e ci appende cinque cose. Su una
superficie `batch` — questa — solo tre esistono:

- **la traccia di sessione**, che finisce in `agent_sessions` e che la pagina Usage mostra
  al cliente;
- **il guardiano di sessione** (`steward`), deterministico, non un secondo modello: toglie
  dal tavolo uno strumento che ha fallito due volte di fila e ricorda al modello di leggere
  il brand quando non l'ha ancora fatto;
- **la toppa al system di ogni step**, che porta le note del guardiano dentro ciò che il
  modello legge.

Le altre due — il controllore in ombra e lo strumento forzato al primo step — sono
dichiarate `surface === 'chat'` e su un batch non hanno mai fatto niente. Sono state
verificate riga per riga prima di lasciarle indietro, non presunte inerti.

Quindi la riscrittura non ha dovuto reinventare un giro: il giro era già dell'SDK. Ha
tolto l'involucro e ha scritto quelle tre cose al punto di chiamata, in ordine, dove si
leggono. Il file è più lungo di ventinove righe e non ha più niente di implicito.

## L'arco che spariva

`harness/index` riesporta `harness/run`, e `harness/run` importa `chat/model` e
`chat/controller` — e `chat/controller` importa `$lib/agent/bridge/verdict`. Ecco come un
orchestratore di batch, che della chat non sa niente, se la portava dentro insieme a
`$lib/agent`. Prendere la traccia dai moduli foglia (`harness/session`, `harness/persist`,
`harness/pipeline`, `harness/steward` — nessuno dei quali importa chat o `$lib/agent`)
toglie quell'arco.

Misurato con una visita transitiva del grafo dal file: prima, `week-planner-agent.ts`
raggiungeva `chat/model` e `chat/controller` in tre passi via `harness/index`. Adesso non
li raggiunge più da sé. Continua a raggiungerli in quattro passi via `strategy-agent.ts`,
che importa ancora `$lib/server/harness` per il proprio giro: è il prossimo della coda.
Restano poi due archi che con il framework non c'entrano — `credits → scheduler →
agent-turns → chat/queue` e `brand-context → design-* → motion-video → chat/artifacts` —
e sono accoppiamenti di infrastruttura, da sciogliere quando si smonta la chat.

Il framework non è stato toccato: `packages/agent-*` è intatto e continua a servire chat,
room e gli altri undici orchestratori. Questo PR non cancella niente.

## Perché i test vengono prima, e perché agganciano l'SDK

Non esiste una versione precedente da confrontare: la storia del repository è un solo
commit squashato. Il comportamento di oggi *è* la specifica, e una riscrittura senza una
specifica scritta è una riscrittura alla cieca. I 21 test di caratterizzazione sono stati
scritti e visti passare **sull'implementazione col framework**, prima di toccare una riga.

Il punto di aggancio è `generateText` dell'SDK e non `harnessGenerateText`. È l'unica
scelta che rende i test una misura invece che una descrizione: `harnessGenerateText`
sparisce con la riscrittura, `generateText` no, quindi gli stessi 21 test giudicano
entrambe le implementazioni senza una riga di differenza. Passano su tutte e due.

Fissano: cosa si carica prima di parlare col modello, l'elenco esatto degli strumenti
offerti, i tetti su bozze e ricerche e che nessuno dei due paga il modello una volta in
più, lo stallo a quattro step identici, il gate che rifiuta di chiudere, la chiusura
automatica e quella di ripiego, le righe scritte in `agent_runs` e `agent_sessions`, la
chiusura forzata quando finiscono tempo o soldi, e il guardiano che il framework applicava
in silenzio.

## La ricetta per gli altri undici

1. **Misura l'arco prima.** Una visita transitiva del grafo degli import dal file dice
   quali archi verso `src/lib/agent`, `src/lib/server/chat` e `packages/agent-*` sono
   *suoi* e quali arrivano da infrastruttura condivisa. Solo i primi sono lavoro di questo
   PR; gli altri annunciarli e lasciarli.
2. **Leggi il giro e scrivilo.** Un orchestratore su framework nasconde il controllo
   dentro l'involucro. Elenca in ordine: chiamate al modello, cosa persiste, cosa ritenta,
   cosa fa quando fallisce. Se non sai dirlo in dieci righe non sei pronto a spostarlo.
3. **Aggancia i test all'SDK, mai al framework.** Un finto `generateText` che esegue una
   sequenza di strumenti scritta a mano, chiama `prepareStep` e `onStepFinish` e valuta le
   `stopWhen` esercita entrambe le implementazioni. Guardali passare sul vecchio codice
   prima di scrivere il nuovo: un test che non è mai passato sul vecchio non dimostra
   niente.
4. **Conta le chiamate al modello nei test.** `expect(draftWeekSeeds).toHaveBeenCalledTimes(1)`
   è l'unico modo di dimostrare che la spesa non è cambiata senza pagare due volte per
   scoprirlo. La spesa che sale è un difetto, non un compromesso.
5. **Verifica quali aggiunte del framework sono inerti sulla tua superficie**, riga per
   riga. Su `batch` due delle cinque non fanno niente. Su `room` o `chat` sarà un altro
   conto: non copiare questa conclusione, rifalla.
6. **Prendi le foglie, non l'indice.** `harness/session`, `harness/persist`,
   `harness/pipeline` e `harness/steward` non importano chat né `$lib/agent`; `harness/index`
   sì, perché riesporta `harness/run`. Sono 1.030 righe di traccia e di politica
   deterministica che non stanno nelle 161.166 da cancellare: riusarle costa zero e tiene
   in piedi la pagina Usage.
7. **Metti il vincolo in un test, non in un commento.** Un import verso i moduli foglia è
   esattamente ciò che un riordino futuro «semplifica» ricollassando sull'indice, e
   ricompare l'arco verso la chat senza che nessuno se ne accorga.
8. **Separa il riordino dal cambio di comportamento**, in commit diversi. Qui il
   comportamento non cambia affatto: è tutto riordino, e i test lo dimostrano.

Il prossimo naturale è `strategy-agent.ts`: è quello che tiene ancora dentro il week
planner, e con lui se ne vanno anche `agentModel`, `withAgentFallback` e la matematica del
budget che quattro orchestratori si passano.

## Cosa dipende ancora dal framework, senza sconti

Il conto va detto per intero, perché una mezza verità qui costa un PR sprecato dopo.

`packages/agent-*` (cinque pacchetti: `agent-adapters`, `agent-client`, `agent-contracts`,
`agent-core`, `agent-kit`) è intatto, e in `src/lib` è importato direttamente da 37 file
non di test: quasi tutto `src/lib/agent`, più `chat/action-approval`,
`chat/model-preference`, `chat/persistence`, `chat/thread-events`,
`server/agent-kit-effects-store`, `server/sandbox`, `chat-model-policy`, `chat-tiers`,
`models/catalog` e `thread-cursor`.

Il censimento «file di `src/lib/server` che importano `$lib/agent/`, `@anomalia/agent-*` o
`server/harness`» conta 27 file non di test **prima e dopo**: `week-planner-agent.ts` ci
resta dentro perché importa quattro moduli sotto `harness/`. Quello che è cambiato non è
il conteggio, è l'arco: non importa più `$lib/server/harness` (l'indice) e quindi non
raggiunge più `chat/model`, `chat/controller` e `$lib/agent/bridge/verdict` per conto suo.
Il censimento va rifatto sui moduli e non sui prefissi quando i dodici saranno finiti.

Gli undici che restano sul framework: `director.ts`, `produce-agent.ts`,
`strategy-agent.ts`, `seo-agent.ts`, `image-agent.ts`, `analytics-review-agent.ts`,
`media-generator/agent.ts`, `media-generator/ugc-agent.ts`,
`media-generator/ugc-plan-agent.ts`, `motion-video/agent.ts`, `sandbox.ts` — più
`agent-base.ts`, `agent-kit-effects-store.ts`, `craft-model.ts`, `harness-skills.ts` e
tutta la chat. Non è stata tolta una riga: la cancellazione arriva quando l'ultimo
consumatore è uscito.

## Niente changelog pubblico

Il cliente non può osservare nessuna differenza, ed è il criterio di riuscita: stessi seed,
stesse righe in `agent_runs` e `agent_sessions`, stesso prompt (9.709 caratteri, identico
prima e dopo su una corsa vera), una sola chiamata al giro. Un changelog pubblico qui
direbbe che qualcosa è cambiato per chi usa il prodotto, e non è vero.
