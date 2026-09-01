# Il pavimento di esecuzione del design arriva ai render dei post

## Cosa c'era prima

Il wall di `/design` fa giudicare ogni pezzo da un modello vision (`design-judge.ts`:
`design_score`, `design_note`, `design_tags`, punteggi per asse) e `wall-digest.ts` ne
distilla un testo compatto — `designWallDigestSection()` — che dice, con istruzioni
osservabili, cosa fa il lavoro forte in questo momento: struttura del layout, densità e
gerarchia tipografica, ruoli della palette, mosse compositive, uso del vuoto.

Quel testo aveva **un solo consumatore**: `content-preview/caption-quality.ts`, cioè la
qualità della *didascalia*. Il percorso che genera davvero la grafica —
`content-preview/images.ts` — non importava nulla da `wall-digest`. L'unico contatto fra
le immagini dei concorrenti e la generazione era un divieto in `plan-pipeline.ts`, per
giunta su thumbnail scelte per *performance*, non per qualità di design.

Risultato osservato dal proprietario: in `/design` l'AI riconosce benissimo cosa è fatto
bene; i produttori dentro l'app continuano a consegnare grafiche brutte.

## Cosa cambia

`RenderImageOpts` porta un campo `craftFloor`, e `buildImageRequest` lo concatena
**subito dopo `HOUSE_LOOK`**, prima dello stile del brand. È il posto giusto per una
ragione sola: `HOUSE_LOOK` è già il pavimento di esecuzione statico ("IMAGE QUALITY
BAR"), e il digest è il suo gemello dinamico. La regola sta scritta in **un posto solo**;
tutto il resto è approvvigionamento.

Ad approvvigionarlo sono `renderWithQC` e `renderCarouselSlide`, i due ingressi dei
produttori di grafica: da lì passano il batch settimanale (`weekly-planner.ts`), la
creazione del post singolo e del carosello (`creation.ts`) e le immagini degli articoli
(`articles.ts`).

## Perché non `renderPostImage`, che sarebbe stato un punto solo

`renderPostImage` è il chokepoint di *ogni* render, UGC compreso: `ugc-batch.ts` ci passa
ritratti, still e frame di copertina. Un pavimento pensato per il design da feed
("un titolo sovradimensionato, 3-5 parole, 60% dell'altezza") su un frame UGC candid è un
peggioramento, non un miglioramento — e il percorso video/UGC ha già il suo pavimento, il
digest *trending*. Due righe di approvvigionamento invece di una sono il prezzo di non
toccare quel percorso.

## Perché non nei 5 punti dove si costruiscono i `renderOpts`

`creation.ts` li costruisce tre volte, `weekly-planner.ts` una (dentro il ciclo per post),
`articles.ts` una. Cinque copie della stessa riga divergono alla prima modifica.

## I due assi, tenuti separati

L'anti-moodboard confondeva due cose diverse: differenziarsi nel **soggetto** e rifiutare
l'**artigianato**. La frase «NEVER imitate or echo these images' style, layouts or ideas»
governa i *seed*, che portano anche `art_direction` (medium, grammatica di pagina,
palette): cioè diceva allo stratega di eseguire diversamente dal campo, non solo di
mostrare altro. Ora dice che il soggetto va differenziato e che l'esecuzione deve
pareggiare o battere il campo.

La separazione vera però è di **stadio**, ed è quella che regge: il soggetto si decide
nel prompt di strategia (`planStrategy`), il pavimento di esecuzione entra nel prompt di
render. Sono due chiamate diverse: nessuna delle due contiene l'istruzione dell'altra.

## Costo

`designWallDigestSection()` scaricava il JSON dal bucket a ogni chiamata. Con l'aggancio
in `renderWithQC` + `renderCarouselSlide` sarebbe diventato un download per post e per
slide, dentro il ciclo del batch. `digestSection` ora memoizza la *lettura* per processo
(non la sezione): la freschezza resta valutata a ogni chiamata, quindi un digest che
supera i 30 giorni degrada comunque a stringa vuota. Il digest è globale e oggi non ha
nemmeno un rigeneratore, quindi una lettura per processo è esatta.

## Scartato

- **Rendere `buildImageRequest` async** per leggere da sé il digest: è pura apposta
  (`articles.ts` la usa per costruire richieste Batch identiche byte per byte), e la
  purezza è ciò che rende il prompt testabile senza rete.
- **Una cache con TTL**: il TTL sarebbe stato una seconda nozione di freschezza accanto a
  `DIGEST_MAX_AGE_DAYS`, che già esiste e già decade correttamente perché memoizziamo il
  record, non la sezione.
- **Agganciare anche `image-agent.ts`**: il loop agentico scrive i propri prompt e ha già
  un giro di ispezione e QC. È un altro lavoro, non questo.

## Cosa questo NON dimostra

Che le immagini diventino più belle. Il test prova che il pavimento arriva al prompt e che
senza digest il prompt resta identico byte per byte. La differenza di qualità si misura
solo guardando immagini prodotte prima e dopo, e non è stata misurata.
