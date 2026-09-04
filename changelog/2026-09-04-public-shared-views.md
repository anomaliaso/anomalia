# Viste pubbliche: un link per il cliente, mai un account

Fase 3 del piano agenti esterni. Un'agenzia consegna al cliente il calendario del mese o il
report di quel mese con un URL, e il cliente lo apre senza registrarsi, senza essere invitato
nel brand e senza comparire da nessuna parte.

Prima non c'era niente: l'unico modo di far vedere il lavoro a un cliente era invitarlo nel
brand — cioè dargli un account con accesso a tutto — oppure fare screenshot.

## Perché uno snapshot e non una query dal vivo

La rotta pubblica legge **una riga** e nient'altro. Non torna su `posts`, non torna su `brands`,
non tocca nessuna tabella viva.

Non è una preferenza di prestazioni, è la sola forma che regge nel tempo. `posts` ha oltre
cinquanta colonne — `image_prompt`, `qc`, `approval_token`, `attention_reason`, `design` — e ne
guadagna di nuove ogni mese, scritte da chi sta risolvendo un altro problema. Con una vista dal
vivo, la prossima colonna esce da ogni link già consegnato: nessuno la aggiunge pensando ai link
pubblici, e nessun test la ferma. Con lo snapshot, quello che è uscito è quello che l'allowlist
ha copiato il giorno della creazione, e resta quello per sempre.

Scartato: la vista dal vivo con una `select` ristretta. Una `select` ristretta è una promessa che
vive in una riga di codice; lo snapshot è un fatto già scritto nel database.

## Perché una allowlist e non una deny-list

Lo snapshot si costruisce campo per campo (`CALENDAR_POST_FIELDS`, `REPORT_POST_FIELDS`), mai
copiando una riga e cancellando le chiavi scomode. Una deny-list si dimentica del campo
successivo — e il campo successivo lo aggiunge qualcun altro, in un'altra PR, senza sapere che
esiste un link pubblico.

Il test che conta non è quello del percorso felice: è quello che asserisce **l'insieme esatto**
delle chiavi. Il giorno in cui `getCalendar` selezionerà una colonna in più, quel test diventa
rosso invece che il link diventare loquace. Provato: aggiungendo `image_prompt` alla proiezione,
tre test cadono prima di qualunque revisione umana — l'insieme esatto delle chiavi, la ricerca
dei segreti nello snapshot, e quello sulla riga che l'endpoint scrive davvero.

Fuori restano anche gli id — di post, di riga, di brand — e lo slug. Un identificatore privato
è il punto da cui si parte per indovinare il resto.

Lo `status` non esce grezzo: `pending_user`, `approved`, `failed` sono il nostro workflow, non
una cosa che un cliente debba leggere. Diventa `planned` o `published`, in una funzione sola.

## Perché il token non viene conservato

Il token è casuale (32 byte, base64url) e la riga tiene solo il suo sha256. Chi lo crea lo vede
una volta; se non lo salva, non si recupera — si revoca e se ne fa un altro. Un dump del
database non produce link funzionanti, e nemmeno chi ha accesso alla tabella può aprire una
vista che non ha creato.

Scartato: un token firmato con HMAC (come `signApproveToken`, che il repo già ha). Non si revoca.
Un cliente che se ne va, un link finito nel gruppo sbagliato, una collaborazione chiusa: con un
token firmato l'unica risposta è ruotare `APP_SECRET` e spegnere ogni link esistente, compresi
quelli degli altri clienti.

## Perché revocato, scaduto e inesistente sono la stessa risposta

Tre motivi per cui un link non vale, **una** funzione che li decide (`liveShare`), un `null` solo
che risale fino a un `404` identico. Un messaggio tipo «questo link è stato revocato» conferma
che il link è esistito, quindi che il brand esiste: un oracolo gratis per chi prova URL a caso.

Il controllo sta in JavaScript e non nella `where` della query apposta: in SQL sarebbero tre
condizioni sparse in una stringa, e la stessa regola andrebbe riscritta in ogni query futura.
In un posto solo, diverge con nessuno.

Il caso che invece **non** si confonde con un link inesistente è la tabella assente: quello è un
guasto nostro, risponde `500`, e la superficie autenticata dice per nome quale file applicare.

## La rotta pubblica è fuori dal registry, apposta

`/share/[token]` non sta sotto `/api/v1/brands/:slug` e non entra in `BRAND_ENDPOINTS`. Non è un
endpoint di brand: non ha uno slug, non ha un chiamante autenticato, e dall'URL non si ricava
quale brand ci sia dietro. Entrarci significherebbe ereditare `authenticate` +
`loadBrandForUser`, che è esattamente ciò che non deve succedere.

Legge con la chiave di servizio, come `/approve/[token]` e `/blog/[site]`: l'impronta del token è
l'unica chiave, e la RLS con `auth.uid()` nullo non avrebbe niente da valutare. Ad `anon` i
privilegi sulla tabella sono **revocati** — così nemmeno una policy scritta male in futuro può
aprirla a un visitatore.

## La migration si applica a mano

`supabase/migrations/20260904120000_shared_views.sql`. I deploy di questo repo non eseguono le
migration: finché non la applica una persona, i tre endpoint rispondono `500 shares_not_migrated`
col nome del file, invece di far passare un `PGRST205` che diventerebbe una lista vuota.

`node scripts/schema-drift-check.mjs` la vede: contro la produzione dà ROSSO con una divergenza
sola — `shared_views` assente — e contro lo stack locale, dove è applicata, sparisce.

## Fuori da questa versione

Export PDF, viste `proposal`, calendario dal vivo. La versione uno è fatta di snapshot
revocabili; il vivo arriva quando privacy e cache saranno provate, come dice il piano.
