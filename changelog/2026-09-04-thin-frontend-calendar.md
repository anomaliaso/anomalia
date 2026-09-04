# Il calendario della nuova shell, contro la REST e non contro il database

Il piano `docs/external-agent-plan.md` (Fase 4) elenca otto rotte per la shell nuova, e nella
tabella dei rischi elenca anche *"UI rewrite expands again"* con il controllo *"Ship only the
control-plane surfaces listed above"*. Otto rotte in una volta è esattamente il modo in cui quel
rischio si avvera. Qui ne arriva **una**: il calendario.

È la prima giusta per tre motivi. È il ciclo operativo vero (pianifica, rivedi, modifica,
approva). Il piano dice che *assorbe* la coda di approvazione e il dettaglio del post invece di
tenerli come aree separate — quindi una rotta sola copre tre pagine di oggi. E stressa il confine
REST più di qualunque altra vista: legge un mese, apre un post, ne riscrive la copy, lo approva.
Se il calendario regge contro la REST con dei numeri decenti, le altre seguono lo stesso schema;
se non regge, meglio scoprirlo su una rotta che su otto.

## Dove vive, e perché lì

`/v2/:brand/calendar`.

La mappa del piano dice `/app/:brand/calendar`, che l'app di oggi occupa già — e la consegna era
esplicita: **non toccare niente sotto `src/routes/app/[brand]/`**. Serviva un indirizzo dove
stare finché la parità non è dimostrata.

`/v2` è un prefisso di versione, non un nome di prodotto: dice "seconda versione di `/app`, non
ancora al posto della prima" senza inventare vocabolario che poi va disimparato (`/console`,
`/next`, `/shell` avrebbero tutti promesso qualcosa). La promozione, il giorno che la parità c'è,
è un `git mv src/routes/v2 src/routes/app`: la struttura sotto è già quella della mappa del piano.
Nessuna collisione con `/api/v1`, che sta sotto `/api`.

## La REST è il confine, davvero

La pagina non legge Supabase. Il `load` prende la sessione da `locals.safeGetSession()` — solo
per avere il token — e poi chiama `GET /api/v1/brands/:slug/calendar` con quel Bearer. Le due
azioni fanno lo stesso: `PUT /posts/:id` per la copy, `POST /posts/:id/approve` per
l'approvazione. Zero import da `$lib/server/cli-queries` nella pagina.

Non è purismo: è il punto dell'esercizio. Web, MCP e CLI passano dalle stesse regole di prodotto,
quindi una regola che cambia nell'endpoint cambia per tutti e tre insieme, e un difetto trovato
da uno è un difetto per tutti. La prima volta che la pagina avesse letto una query del server,
il calendario e `anomalia content` avrebbero potuto divergere in silenzio.

SvelteKit serve il `fetch` interno del load senza un vero giro HTTP, quindi il confine non costa
una richiesta di rete in più.

## Le primitive: due aggiunte, il resto riusato

Il piano dice di aggiungere **solo** le primitive che una superficie spedita usa davvero, e di
riusare quelle già in `src/lib/components/ui`.

Riusate: `button`, `badge`, `label`, `sheet` (il pannello del post entra da destra invece di
essere una rotta a sé).

Aggiunte, due: `textarea` — la copy si modifica lì — e `alert-dialog`, per la conferma
dell'approvazione. `alert-dialog` non è decorazione: `role="alertdialog"`, trappola del focus,
Escape, e l'azione che manda un post fuori dall'edificio è esattamente il caso per cui la
primitiva esiste.

`shadcn-svelte add` ha anche riscritto `button.svelte` (riordino di classi, nessun
comportamento diverso) e ha alzato `tailwind-variants` in `package.json`: entrambi ripristinati.
Un bump di dipendenza non c'entra niente con questa PR.

## L'approvazione dice quello che fa

Questo è il pezzo che conta. Il contratto di oggi, scritto nel piano senza giri di parole:
**approvare autorizza la distribuzione e la tenta subito.** Nessuno stato nuovo è stato
inventato, nessuna parola è stata ammorbidita.

Nel pannello la conseguenza si legge **prima** del clic, in tre pezzi:

1. una riga fissa: approvare autorizza la distribuzione e consegna il post agli account
   collegati subito, non c'è un passo "pubblica" separato;
2. la data vera, calcolata dal post: `distributionNote` dice l'istante nel fuso del brand se è
   ancora nel futuro, e altrimenti dice che il post esce al primo slot utile — *possibly right
   away*. È l'unico punto in cui il testo poteva mentire, e per questo è una funzione pura con
   tre test: la scorciatoia sarebbe stata scrivere "programmato per {data}" anche quando la data
   è passata, che è precisamente il caso in cui il post esce all'istante;
3. un `alert-dialog` che ripete la conseguenza e nomina la piattaforma, con "Keep it pending"
   come uscita.

Il bottone dice *Approve and distribute*, non *Approve*.

## Due difetti trovati costruendola

**L'ultimo giorno del mese spariva.** `getCalendar` costruiva la finestra della query così:

    const lastDay = new Date(year, month, 0);
    const endStr = lastDay.toISOString().slice(0, 10);

`new Date(2026, 8, 30)` è mezzanotte **locale del server**. A est di UTC, `toISOString()` la
riporta al giorno prima: con `TZ=Europe/Rome` la finestra di settembre diventava
`2026-08-31 … 2026-09-29`. Ogni post dell'ultimo giorno del mese era invisibile nel calendario —
e quello del 31 del mese precedente compariva di straforo. Su Vercel non si vede perché le
funzioni girano in UTC; su qualunque runtime che non lo sia, sì.

Non è un difetto del frontend: `getCalendar` è la lettura condivisa da REST, CLI e MCP, quindi
`anomalia content` e `get_calendar` mentivano allo stesso modo. Il test di regressione fissa il
fuso del server dentro il test (`process.env.TZ`), così è rosso anche su un runner UTC invece di
esserlo solo sulla macchina di chi l'ha scritto. La finestra ora si costruisce dai numeri, senza
passare da un `Date` locale. Sta in un commit a parte: è un cambio di comportamento del backend,
non la nuova superficie.

**`.grid` di `app.css` sequestra l'utility `grid` di Tailwind.** `src/app.css` (globale, su ogni
pagina) definisce `.grid { display: grid; grid-template-columns: 1.7fr 1fr; gap: 16px }`. È una
classe di layout scritta a mano che porta lo stesso nome dell'utility Tailwind. Le utility di
Tailwind qui sono `important` e vincono su `display`, ma `grid-template-columns` non ha una
controparte da sovrascrivere: resta quella di `app.css`. Risultato, l'`alert-dialog` di
shadcn — che usa `grid` — usciva su due colonne, con titolo, testo e bottoni affiancati e il
footer fuori dal riquadro.

Rimediato **localmente** al punto di chiamata (`flex flex-col` su Content e Header, che
tailwind-merge risolve togliendo `grid`), come il piano permette esplicitamente: *replace styling
locally when it does not fit*. Rinominare `.grid` in `app.css` toccherebbe decine di pagine
legacy e non è il lavoro di questa PR — ma è una mina che ogni prossima primitiva shadcn può
pestare, e va disinnescata prima che `/v2` diventi `/app`.

## Le condizioni stanno in un posto solo

`POST_STATES` è una tabella: per ogni status, l'etichetta, il tono del badge, se si modifica, se
si approva. Uno status sconosciuto non concede niente. Non c'è un `if (status === 'published')`
sparso nella pagina e un altro nel pannello: la prossima riga di stato si aggiunge alla tabella e
si vede accanto a tutte le altre.

## Il fuso orario è del brand, non del server

`getCalendar` torna gli istanti in UTC e il fuso del brand a parte. Mettere un post nella casella
del giorno leggendo la data del server sposta di un giorno tutti i post di sera: un post delle
23:30 UTC del 31 agosto è il 1° settembre a Roma. La griglia raggruppa con
`Intl.DateTimeFormat('en-CA', { timeZone })`, e il test che lo tiene fermo è
`un post di fine mese cade sul giorno del brand, non su quello UTC`.

Conseguenza meno ovvia: la griglia mostra **sempre sei settimane**. Con cinque, un mese che
chiude di domenica (maggio 2026) faceva sparire dalla vista il post che nel fuso del brand
scivola al giorno dopo — il bordo della griglia cadeva prima. Sei settimane coprono sempre
l'ultimo giorno più uno, e in più l'altezza non balla navigando fra i mesi. Anche questo ha il
suo test.

Le bozze senza data non finiscono su "oggi": stanno in una fascia a parte sotto la griglia, che
dice cosa sono e perché non sono sul calendario. `get_calendar` le marca già `isDraft` — una
distinzione sistemata di proposito a suo tempo, e qui è onorata invece che appiattita.

## JavaScript iniziale — misura NON presa

Il piano chiede di misurare la rotta nuova contro un SvelteKit vuoto. **Non è stato fatto**, e il
numero non c'è: serve un `vite build` di produzione, e la macchina su cui girava questo lavoro era
in swap con nove agenti in parallelo. Un numero inventato sarebbe peggio di nessun numero.

Quello che è stato fatto invece è la leva che quel numero servirebbe a giudicare: il pannello del
post — `Sheet` e `AlertDialog`, cioè tutto bits-ui — sta in un componente a parte importato
dinamicamente al **primo post aperto**, non al caricamento della rotta. La griglia del mese, la
navigazione fra i mesi e la fascia delle bozze non caricano una riga di bits-ui. Lo script per
la misura è pronto (chiusura transitiva del manifest Vite per: framework da solo → più il layout
di root → più la rotta → più il pannello) e va eseguito dopo un build su una macchina scarica.

Il conto grosso è comunque già visibile a occhio nudo, e non è di questa rotta: vedi sotto.

## Cosa non è stato costruito, di proposito

- **Nessun `approve-all`.** L'endpoint esiste. Un bottone che approva tutto è un bottone che
  distribuisce tutto: se una superficie deve rendere leggibile la conseguenza prima del clic,
  quella conseguenza moltiplicata per venti post non è leggibile.
- **Nessun `GET /posts/:id/media`.** La risposta del calendario porta già caption, media_url,
  piattaforma, status e data: aprire un post non costa un secondo giro. Le slide dei carousel e
  i video restano fuori — quando serviranno, quell'endpoint è lì.
- **Nessun drag-and-drop, nessun reschedule, nessun delete, nessun revoke.** Sono altri verbi,
  ognuno con la sua conseguenza da rendere leggibile.
- **Nessuna shell, nessun layout `/v2`.** Una rotta sola non ha bisogno di una navigazione: il
  layout condiviso si estrae quando la seconda superficie lo chiede davvero.
- **Nessun changelog pubblico.** Niente manda un cliente su `/v2`: annunciare una superficie che
  nessuno può raggiungere è una riga che invecchia male.

## Quello che resta storto

Il `+layout.svelte` di root è globale e non si scavalca: svelte-i18n, analytics, cookie banner e
lo shimmer d'ingresso entrano anche in questa rotta, che non ne usa nessuno. Il piano chiede di
*rifiutare le dipendenze globali che alzano il JavaScript iniziale senza servire la prima
interazione*: dentro una rotta non si possono rifiutare. È il primo conto da pagare il giorno in
cui `/v2` diventa `/app`, e il numero qui sopra dice quanto vale.
