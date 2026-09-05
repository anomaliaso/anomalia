# `generate_video`: animare una foto della libreria, senza post

Andrea aveva un gatto bianco in libreria, rifinito con `refine_image`. Ha chiesto: *«puoi animarlo
con un video di 5s?»*. L'agente ha risposto che per animare **quella** foto doveva prima metterla
come copertina di una bozza, e alla richiesta *«voglio solo il video, non un post»* ha concluso:

> *«Il collegamento Anomalia disponibile qui espone l'animazione solo per la copertina di un post;
> non permette di animare direttamente un file della libreria.»*

**Ha detto il vero.** `make_video` è `POST /posts/:id/media/video`: genera *e* attacca, e vuole un
post che esista. Non c'era nessun altro modo di ottenere un clip.

È lo stesso buco delle immagini, alla lettera: due volte su due l'agente ha guardato `tools/list`,
non ha trovato il nome di quello che gli serviva, e si è arreso — una volta ridisegnando un gatto da
zero, una volta rinunciando.

## Un tool, non due

*«Anima questa foto»* è image-to-video, ed è espresso con **`base_media_id` su `generate_video`**,
non con un `animate_image` separato: **è il tipo del media di partenza a decidere il comportamento**,
e un tool in più sarebbe un nome in più da trovare — che è precisamente la cosa che ha fallito.

Sotto non c'era niente da inventare. `submitAndTrackVideoRender` accetta già `imageUrl`, che è la
copertina da animare, e `resolveVideoModel({ hasCover })` sceglie da solo fra text-to-video e
image-to-video. Mancava solo la porta.

## Due mestieri, due cataloghi

Animare una foto e filmare da un prompt sono lavori diversi e il catalogo lo sapeva già: lo slot è
`videoImageModel` con una sorgente e `videoModel` senza. Il `model` per chiamata si valida contro
quello giusto, quindi un modello che sa solo filmare da testo viene **rifiutato** quando gli si
chiede di animare, con l'elenco di quelli che andavano bene — invece di essere accettato e scartato
dal renderer.

## Il difetto che questa PR ha trovato per strada

`resolveLibraryId` saltava la lettura quando l'id era un UUID completo: si fidava della forma. Il
controllo di appartenenza arrivava solo al passo dopo, che sa dire «non è un'immagine» ma non «non è
tua» — quindi **l'id di un altro inquilino tornava con l'errore sbagliato**. Ora si interroga sempre,
e i due casi hanno due errori distinti: `source_not_found` e `source_not_an_image`.

Il buco era latente anche su `refine_image`, già mergiato, e si chiude nello stesso punto: la
funzione è una sola e tutti i chiamanti ci passano.

## La regola che vale su tutt'e due le famiglie

Una sorgente che non si risolve **FERMA la richiesta**. Filmare da zero un prompt quando qualcuno ha
chiesto di animare la sua foto è il difetto travestito da rimedio: l'agente paga un clip che non
c'entra e crede di aver animato la sua immagine.

## Cosa NON è in questa PR

- **`refine_video`.** Serve `transformVideo`, che è sincrono da cima a fondo — `createKieTask` +
  `pollKieTask` fino a 600s + `persistMp4` + l'addebito, in una funzione sola, con in più un ramo
  Runway (`aleph`). Renderlo un lavoro come `generate_video` è una PR sua, non una riga: la coda
  `video_renders` è modellata su `submitVideoRender`/`finishVideoRender`, che sono generate-shaped.
  Consegnarlo sincrono bloccherebbe un client MCP per dieci minuti, cioè non consegnarlo.
- **`make_video`** resta dov'è: funziona e ha chiamanti. Qui si aggiunge il soggetto che mancava.
- **Il trasporto OpenRouter** (#336): nessun default spostato, i video vanno ancora su kie.
