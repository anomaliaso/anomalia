# La panoramica del brand nel frontend sottile — `/v2/:brand`

La pagina d'ingresso del frontend sottile: quanti post aspettano l'approvazione, qual è il
prossimo in uscita, e lo stato del brand in fatti. Da lì si va al calendario e all'elenco post.

## Perché esiste

Un frontend senza pagina d'ingresso costringe a conoscere le URL. E le tre domande che un utente
si fa aprendo il prodotto sono sempre le stesse: *devo fare qualcosa? sta per uscire qualcosa?
è tutto a posto?* Tre sezioni, tre risposte.

## Cosa c'era prima

La dashboard di `/app/:brand`, che risponde alle stesse domande dentro una decina di riquadri,
grafici e scorciatoie. Verrà smantellata insieme al resto del vecchio frontend.

## Come è costruita

**Due letture, nessun database.** `GET /api/v1/brands/:slug` (il brand più i conteggi che
`getBrandDetail` già calcola) e `GET /api/v1/brands/:slug/posts?status=scheduled`, in parallelo.
Nessun import da `$lib/server`, nessuna azione: la pagina è di sola lettura.

**`nextOut` è l'unica cosa che decide qualcosa**, e decide poco: il post programmato più vicino
*nel futuro*. Scarta i passati e quelli senza data, e non inventa un "prossimo" quando non c'è —
la scorciatoia facile (prendere il primo della lista) mostrerebbe un post di ieri come prossimo in
uscita. Cinque test, uno per ogni modo di sbagliare.

**Le date sono nel fuso del brand.** `momentInZone` sul timezone che arriva dall'API: le 23:30 UTC
del 31 agosto sono il 1 settembre a Roma. Stesso difetto già pagato una volta nel calendario.

## Cosa è stato scartato

**Niente grafici, niente riquadri decorativi, niente chat.** Lo "stato del brand" è una lista di
fatti — stato, piano, account collegati, piano editoriale attivo o no, programmati, pubblicati,
fuso — e l'ultimo run dell'automazione con il suo errore se c'è stato. Un numero è un numero: non
gli serve una card intorno.

**Niente verdetti scritti qui.** La pagina non dice "senza account collegati non esce niente":
mostra `Connected accounts: 0` e lascia parlare il dato. Una regola di prodotto scritta nel
frontend è una regola che diverge dal server al primo cambiamento.

**`GET /brands/:slug/doctor` non è stato usato**, pur essendo la risposta migliore a "è tutto a
posto?": è read-only, senza AI e senza crediti, e calcola sul server esattamente il verdetto che
qui servirebbe. Ma la sua prosa è in italiano e i suoi `fix` mandano a `/approvals` e a
"Impostazioni → Piattaforme", cioè al frontend che stiamo smantellando. Metterla in una superficie
inglese vorrebbe dire trascinarci dentro due lingue e il vecchio vocabolario. Quando il doctor
parlerà la lingua dell'utente e indicherà le rotte nuove, questa sezione diventa una riga sola.

**Niente `+layout.svelte` per `/v2`.** Servirebbe per la navigazione condivisa, ma nessuna delle
tre superfici ne ha ancora abbastanza da condividere: due link in fondo alla panoramica bastano, e
un layout scritto ora sarebbe scritto sulle prime tre rotte di otto.

**Nessuna utility `grid`.** `app.css` ha un `.grid` globale (`grid-template-columns: 1.7fr 1fr`)
che dirotta chiunque usi la classe `grid` senza un `grid-cols-*` accanto. Qui è tutto flex.

## Debito noto

`momentInZone` è un doppione di quello in `calendar/` (PR #229) e in `posts/` (PR #235): le PR
sono indipendenti per non incatenare l'ordine di merge. Quando sono tutte su `dev`, la pulizia è
un file solo in `src/routes/v2/[brand]/` e tre import ripuntati.
