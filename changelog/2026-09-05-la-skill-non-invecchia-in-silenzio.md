# La skill non invecchia più in silenzio

`cli/skills/anomalia/` è quello che un agente esterno legge per decidere cosa Anomalia sa fare.
In due giorni ha fatto fallire due sessioni vere, e in nessuna delle due il difetto era nel
codice:

1. Un'immagine già in libreria, la richiesta «rendila rossa». L'agente ha risposto che Anomalia
   non sa modificare un asset esistente e ha ridisegnato il soggetto da zero — un render pagato
   per una foto diversa. `refine_image` esisteva da `21c530d7` (#323, 4 settembre) e la skill lo
   nominava già: il modello non l'ha trovato perché nessuna riga metteva il nome del tool accanto
   al problema con le parole dell'utente.
2. «Anima questa immagine in un video di 5 secondi». L'agente ha risposto che l'animazione è
   esposta solo per la copertina di un post e ha rinunciato.

Il secondo caso era vero, il primo no. In entrambi ha deciso la skill, non il prodotto.

## Cosa diceva di sbagliato

- **`query` non era nominato da nessuna parte.** È l'unico tool che legge una tabella qualsiasi
  del database con i permessi dell'utente, sola lettura, gratis. Un agente che non sa di averlo
  fa tre chiamate dove ne basta una.
- **`ads_remix` non era nominato da nessuna parte**, e spende crediti. Un tool che costa e che
  nessuno documenta è la combinazione peggiore: non viene usato quando serve, e quando viene
  trovato per caso nessuno sa cosa paga.
- **La skill prometteva un giudizio a pagamento su immagini e video** («judging an image or a
  video is a separate, explicitly paid action»). Quell'azione non esiste più: il giudizio sui
  video è stato tolto il 29 agosto, il controllo qualità sulle immagini con #329 (`0233a657`
  «Drop quality control from images», `911c919e` «Remove the image agent too», 4 settembre).
  Era una bugia detta al modello, che è la forma peggiore: il modello ci costruisce sopra il
  comportamento.
- **Non diceva che un render è un colpo singolo.** Dopo #329 non c'è più nessun critico interno,
  nessun retry automatico: quello che torna è quello che è stato pagato. Il rimedio a un
  risultato storto è `refine_image`, e chi guarda il risultato è l'agente esterno. È un cambio di
  modello mentale, non un tool in più, e senza dirlo la skill lasciava credere in una rete di
  protezione rimossa.
- **Non diceva che il flusso è lineare**: genera il media, passa il suo id a `create_post`. Il
  catalogo, letto dall'alto, lasciava credere che un'immagine o un video passassero per forza da
  un post — che è esattamente la conclusione del secondo fallimento.

## La guardia

Aggiornare la skill la ripara oggi. È già invecchiata due volte in due giorni e nessuno se n'è
accorto finché un umano non ci ha sbattuto contro: mancava il filo che confronta quello che la
skill dichiara con i tool che esistono davvero.

`cli/skills/tools-coverage.test.ts` lo tiene, e fallisce in due direzioni:

- un tool esiste e `references/tools.md` non lo nomina → nessun agente lo troverà mai;
- `tools.md` nomina un tool che non esiste → un agente ci proverà e fallirà.

L'insieme dei tool che esistono è l'unione di due sorgenti: i `tool:` dichiarati in
`packages/api-contracts/src/*.ts`, e una **lista esplicita degli undici registrati a mano** in
`cli/mcp/tools/`, ognuno con accanto il motivo per cui non passa dal registry (`list_brands`
perché `GET /api/v1/brands` non sta sotto un brand e il registry è scoped sul brand;
`produce_week` perché legge il piano per trovare la bozza dei seed prima di produrla; e così
via). Il motivo è un valore, non un commento: sta in un `Record` su cui il test asserisce, quindi
non può marcire senza far fallire qualcosa. Un dodicesimo `registerTool` aggiunto senza motivo fa
rosso — aggiungerne uno resta una decisione che si vede in diff.

L'estrattore della skill legge la **prima cella** delle righe di tabella di `tools.md`, che è dove
un agente cerca il nome di un tool. Preciso: sui file di oggi non produce un solo falso positivo
né un solo falso negativo.

### La trappola che il test evita

Un test che scandisce dei file e asserisce il vuoto passa anche quando non trova niente: se
l'estrattore si rompe, i due insiemi diventano vuoti, la differenza è vuota, e il test diventa
verde proprio nel momento in cui ha smesso di misurare. Per questo asserisce **prima** di aver
trovato un numero plausibile di nomi in ognuna delle tre sorgenti (100 dal registry, 8 a mano,
100 nella skill). Cambiando `tool:` in `toolz:` nell'estrattore, il conteggio scende a 0 e il test
fallisce invece di tacere.

### Rosso osservato, quattro volte

Un test che non hai visto fallire non sai cosa misura. Prima di renderlo verde:

1. **Nome finto nella skill** — riga `| \`teleport_brand\` | (MCP only) |` aggiunta a `tools.md`:
   rosso su «un tool che la skill nomina e non esiste».
2. **Nome vero tolto dalla skill** — riga di `refine_image` cancellata: rosso su «un tool che
   esiste e la skill non nomina».
3. **Estrattore rotto** — `tool:` → `toolz:`: rosso sul pavimento (`0 >= 100` falso), non verde.
4. **Tool a mano senza motivo** — `registerTool('nuke_brand', …)` aggiunto a `plan.ts`: rosso su
   «ogni tool registrato a mano porta il suo motivo».

Il primo rosso, però, non è stato costruito: alla prima esecuzione il test ha trovato da solo
`query` e `ads_remix` mancanti. La deriva che doveva catturare c'era già.

## Cosa è rimasto fuori, e perché

- **`generate_video` / `refine_video`** — `generate_video` lo sta scrivendo un'altra sessione sul
  branch `feat/agent-video-tools`, skill compresa: le sue righe arrivano con la sua PR, non
  duplicate qui. `refine_video` non è nel suo PR (`transformVideo` è sincrono end-to-end e la coda
  `video_renders` è modellata su generate: renderla job-shaped è una PR sua), quindi la skill non
  lo promette. Quando atterrerà, la guardia pretenderà la riga nello stesso commit.
- **`slug` opzionale sui generatori** — proposta, non decisa: tre domande di design ancora aperte,
  fra cui se il caso multi-org rifiuti invece di risolvere in silenzio. Le due frasi che oggi
  dicono «passa `slug` su ogni chiamata brand-scoped» restano come sono. Una riga in meno oggi
  costa meno di una bugia da correggere domani.

## Quello che la guardia ancora non copre

Il test verifica che un tool sia **nominato**, non che la sua descrizione sia **vera**. Il
fallimento numero uno di questa storia — un agente che legge il catalogo, non riconosce la cosa
che cerca e conclude che non si può fare — non sarebbe stato preso da una riga mancante, perché
la riga c'era. Contro quello serve la valutazione degli agenti, non un confronto di stringhe.
