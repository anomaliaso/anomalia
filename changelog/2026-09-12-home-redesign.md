# La home apre sul lavoro, non sul setup

La prima cosa che vedeva chi entrava in un brand era quanto gli mancava. Cinque blocchi che
rispondevano tutti alla stessa domanda: la scala del setup con la barra di avanzamento, i tredici
controlli della crescita, la pipeline a tre zeri, l'elenco delle cose da fare che ripeteva la
coda, e sopra tutti la guida MCP aperta. Nessuno diceva che cosa fosse uscito — e in un prodotto
il cui prodotto sono immagini, la home non ne conteneva nemmeno una.

## Che cosa c'è adesso

**Una domanda, il lavoro, quattro numeri.** In quest'ordine, che è l'ordine in cui si chiede:

1. **La domanda** — «3 cose aspettano la tua approvazione», col post in questione, la sua foto e
   il bottone che lo approva. Se non aspetta niente: «Nessuno aspetta te, l'ultimo è già uscito»,
   con l'ultimo uscito. Se non c'è né l'uno né l'altro, si dice perché.
2. **La striscia** — fino a dieci piastrelle che mescolano ciò che aspetta te, ciò che è in
   programma e ciò che è già uscito, ognuna con la sua pastiglia. Per chi guarda sono la stessa
   cosa: il lavoro del brand. Scorre in orizzontale, non va a capo.
3. **Quattro cifre** — pubblicati, aspettano te, in programma, visualizzazioni.
4. **Una pastiglia ambra** coi controlli che bloccano la produzione, che porta a `/plan`.

Quale delle tre domande la pagina apra lo decide `homeHeadline` (`src/lib/home-headline.ts`),
puro e sotto test. La regola è l'ordine: **azione prima del risultato, risultato prima del vuoto**.
Sta fuori dal componente perché è l'unica cosa qui che si può sbagliare in silenzio.

## Che cosa è sparito, e perché non manca

- **La scala del setup** (otto passi, barra, «nascondi»): diceva quanto mancava a chi era appena
  arrivato, ed era la prima cosa che vedeva chi era arrivato da mesi.
- **`GrowthReadiness` in home**: i tredici controlli hanno già una casa, `/plan`, dove si può
  anche agire su di loro. Qui restano come numero in una pastiglia.
- **La pipeline a tre numeri** (da approvare / schedulati / pubblicati, per social e blog): è
  letteralmente la riga di cifre della testa, disegnata due volte.
- **Le due card in fondo alla performance** («pubblicati», «schedulati»): due delle quattro cifre
  della testa, di nuovo.
- **Le righe di approvazione dentro `homeTodos`**: la testa apre su quelle. `homeTodos` ora
  risponde solo per ciò che aspetta senza scadere — radar, lead, account mancante.
- **La guida MCP in cima**: da ieri ha una porta propria nel footer della barra
  (`2026-09-12-sidebar-install.md`).

## «In arrivo»: una fila, non due riquadri

Erano due pannelli affiancati, «prossimi social» e «prossimi articoli», ognuno col suo titolo e
il suo «vedi tutti». Ma nessuno chiede che cosa esce sui social e poi che cosa esce sul blog:
chiede **che cosa esce**, e la risposta è una fila in ordine di orologio. `upcomingFeed`
(`src/lib/home-upcoming.ts`) unisce e ordina le due code, ed è puro e sotto test.

I tre titoli di sezione perdono il paragrafo che spiegava a parole che cosa fosse la sezione: il
titolo e il link ci arrivano già.

## Materiali come bacheca

La libreria era una griglia di schede quadrate: ogni materiale ritagliato 1:1 con una targhetta
sotto, alta quanto mezza immagine. Il ritaglio buttava via metà di ciò che c'era da riconoscere,
e la targhetta occupava lo spazio che serviva a riconoscerlo.

Ora è una bacheca: ogni materiale tiene la sua forma (verticale, quadrato, panorama), le colonne
si incastrano da sole, il nome scende in sovrimpressione al passaggio e tutto il resto resta a un
clic nel drawer, che non cambia. Il rapporto viene da `width`/`height` della riga, chiuso fra 0.6
e 1.7 perché un pannello 5000×200 spaccherebbe la colonna.

Le colonne sono `columns` CSS: nessuna misurazione, nessun ricalcolo a ogni resize, nessuna
libreria. In cambio riempiono colonna per colonna invece che riga per riga — che è esattamente
come si legge una bacheca.

## Le decisioni che si vedono poco

- **`@container`, non `@media`.** La home e la bacheca vivono dentro il contenitore `workbench`
  dichiarato dal layout del brand, e la sidebar si apre e si chiude: a finestra larga con la barra
  aperta lo spazio vero è duecentotrenta pixel meno di quello che una media query vede. Il resto
  della home usava già `@container`; adesso lo usa tutta.
- **La striscia scorre, non va a capo.** A quattro colonne piene ogni piastrella diventava alta
  trecento pixel e la prima schermata era soltanto lei. A larghezza fissa ne entrano sei o sette e
  nessuna riga resta spaiata in fondo.
- **Senza foto la colonna della foto non esiste.** Riservarla lasciava un rettangolo di vuoto
  largo centootto pixel accanto a una riga di testo.
- **Le chiavi i18n orfanate da questo cambio sono state tolte** dalle quattro lingue. Le altre
  orfane che c'erano già (`toReview`, `controlOk`, `blogsAi*`…) restano: non sono di questo PR.

## Prove

Verificato sullo stack locale (`localhost:8000`, brand `demo`) con post seminati nei tre stati:
i tre rami della testa (`approve`, `published`, `empty`), il post senza immagine, la striscia che
scorre, la bacheca a colonne larghe e a due colonne, il drawer, navigazione ripetuta e
back/forward. Nessun errore in console.
