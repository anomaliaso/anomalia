# Un task kie scaduto si riprende, non si riapre

Andrea ha guardato il cruscotto di kie e ha chiesto se avessimo allungato i timeout, perché *«ci
sta facendo consumare un sacco di chiamate inutili»*. Il numero sul loro cruscotto non tornava col
nostro.

## Il difetto

`pollKieTask` restituiva `undefined` per **due cose diverse**:

- kie ha **rifiutato** il lavoro (`state === 'fail'`) — non ci è costato niente, ritentare è giusto;
- il nostro tempo è **scaduto** mentre kie stava ancora renderizzando — il task resta suo, lo
  finisce e lo fattura.

Il chiamante non poteva distinguerli, quindi trattava entrambi come «non è tornato niente» e
ritentava. Il ritentativo apriva un **task nuovo** mentre il primo continuava a girare. kie li
fattura tutti e due.

Con `IMAGE_TIMEOUT_MS = 300_000` e due tentativi, il caso peggiore è **dieci minuti e due task
pagati** per un'immagine sola. (`MAX_IMAGE_ATTEMPTS = 3` è il percorso Google, non questo: su kie i
tentativi sono due.)

## Perché era invisibile

Il costo si scrive da `creditsConsumed`, che esiste **solo sul ramo `success`**. Un task
abbandonato non produceva nessuna riga in `ai_calls`: addebitato da kie, inesistente da noi. È
esattamente la differenza che Andrea stava guardando fra i due cruscotti.

Ed è anche la spiegazione migliore dei due render a 46 secondi: non serve ipotizzare un ritentativo
del client, il ritentativo ce l'avevamo dentro.

## La correzione

`pollKieTask` ora restituisce un esito esplicito — `done`, `failed`, `timeout` — e la scadenza
**porta con sé il `taskId`**. Non è un dettaglio di tipo: far collassare due stati diversi in un
`undefined` *era* la causa, perché rendeva impossibile al chiamante ritentare solo il caso giusto.

Il ciclo di `renderPostImage` ora passa quel `taskId` al secondo tentativo e **riprende lo stesso
lavoro**, senza ricaricare i riferimenti e senza aprire niente. Il ritentativo vero — quello che
riparte da zero — resta dove ha senso: sul rifiuto, che non abbiamo pagato.

Una scadenza lascia una riga in `ai_calls` con l'esito e il `taskId`, e **senza costo inventato**:
kie ci addebita, ma quanto non si sa finché il task non finisce. Un buco dichiarato è leggibile; un
numero plausibile e sbagliato no.

## Sull'annullamento

**kie non espone un annullamento** nell'API che usiamo: le sole due chiamate sono
`POST /jobs/createTask` e `GET /jobs/recordInfo`. Non ne ho inventata una. Se esistesse, il posto
dove chiamarla sarebbe il ramo `timeout` di `pollKieTask`.

## Il video non serviva sistemarlo

Verificato invece che riscritto due volte: il percorso video **non riapre niente**. `runKieVideoJob`
crea un task e lo interroga una volta sola, senza ciclo; e il percorso asincrono — quello che conta
— fa già la cosa giusta, perché `finishVideoRender` reinterroga il **medesimo** `task_id` salvato su
`video_renders` e restituisce `pending`, così il reconciler lo ripesca al giro dopo. Era già il
modello da copiare.

Gli altri cinque punti che chiamavano `pollKieTask` sono stati adeguati al nuovo esito: nessuno di
loro riapre un task, e ora ognuno dice esplicitamente cosa fa di una scadenza invece di confonderla
con un fallimento.

## Cosa NON è cambiato

I due candidati paralleli di `renderWithQC` (`HIGH_STAKES_CANDIDATES = 2`) e i suoi ritentativi
(`MAX_QC_RETRIES = 2`) restano come sono. Sono una scelta fra qualità e spesa e la decisione è di
Andrea. Questo qui non era una scelta: era pagare due volte lo stesso lavoro.
