# L'agente guarda la grafica che ha appena fatto

## Il difetto, per intero

Una grafica tipografica era **l'unico artefatto del prodotto che nessuno guardava**.

- Le foto AI hanno `renderWithQC`: il render viene giudicato e torna con `qc.score` / `qc.pass`.
- I video hanno `review_video`: Gemini guarda l'mp4.
- Le grafiche hanno `judgeDesign` in `design-judge.ts`, che sul percorso di creazione **non viene
  mai chiamato** — `grep judgeDesign(` fuori dal suo file dà zero. Serve solo a decidere cosa è
  pubblicabile sul wall pubblico.

E il risultato che tornava al modello passava da `compactGraphicPersist`, la cui prima riga
scartava la grafica e la sostituiva con `source_chars: 4312`. **Il numero di caratteri.** Il PNG non
entrava affatto nel risultato. L'agente riceveva `ok: true` più un conteggio e da quello concludeva
che era andata bene.

## Perché il gate non bastava

`inspectGraphicTree` fa analisi statica dell'albero **dichiarato**. Il suo unico controllo di
posizione, `offCanvasIssues`, scatta solo se un blocco ha `position: absolute` con `left`/`top`
interamente fuori tela. Non misura larghezze di testo, non conosce estensioni reali, non vede
sovrapposizioni.

Il caso che ha aperto questa PR era una headline italiana di 46 caratteri che sborda a destra **e**
a sinistra, con due blocchi disegnati uno sopra l'altro: tutti difetti geometrici, nessuno
dichiarato. Il gate era cieco per costruzione, non per una svista — e chi ha scritto il
ridimensionamento della headline lo sapeva, il commento è ancora a `graphic-tree.ts:67`:

> *"Satori wraps, but a 130-character headline set at the display size would wrap past the canvas —
> and there is no measurement available here to discover that."*

## Cosa cambia

Il render torna dentro il risultato del tool, come parte immagine, e il modello lo guarda.

Il ponte del kit non lo permetteva: `execChatTool` faceva `JSON.stringify` dell'intero ritorno,
quindi un PNG allegato sarebbe finito come base64 dentro una stringa — illeggibile e enorme. Ora
`_images` esce dal JSON e diventa una parte immagine vera, e il base64 **non** viene duplicato nel
testo.

## L'onestà che serviva più dell'allegato

`media-in-tool-result` manca su kie, xiaomi e deepseek, e kie in particolare **scarta i media nei
risultati dei tool in silenzio**. Allegare e basta avrebbe significato credere di aver risolto su
tre rotte su quattro.

Quindi il risultato porta `reviewed: true|false`. Quando la rotta non regge l'immagine il testo lo
dice: *"You have not seen this graphic. Do not claim it looks right."* Un modello che sa di non aver
visto può chiedere; uno che crede di aver visto consegna una headline tagliata dicendo che va bene.

## Cosa NON fa

Non misura nulla. Sostituisce un controllo assente con un occhio, e un occhio si distrae. Il passo
successivo è il gate misurato **sui pixel** — inchiostro nella zona di bleed su un fondo piatto è
testo tagliato senza ambiguità, e resvg ci consegna già il PNG. Quello blocca prima di consegnare,
su ogni rotta, e non dipende dall'attenzione di nessuno.
