# La rubrica porta il suo medium, il carosello porta la sua storia

Il piano usciva corretto e piatto. Un brand editoriale — persone, esperienze,
niente catalogo — riceveva sette post ineccepibili e intercambiabili, e un
carosello che avrebbe dovuto raccontare la storia di qualcuno usciva come sei
immagini vicine. Il difetto non era il modello: era lo schema.

Due campi mancavano, e mancavano nel posto che conta.

**`PostSeed.beats`** — un carosello portava `angle` (una riga) più
`subject`/`setting`/`props` (una scena sola) e `slide_count`. Tutti campi
singolari. Le slide venivano inventate dopo, nel pass 2, partendo da quella riga.
Una storia ha una battuta per slide e va decisa nel piano, dove il cliente la
legge PRIMA di approvarla: `beats` è quella storia, vincolante, una battuta per
slide. `clampMediaCapabilities` fa seguire lo `slide_count` alle battute invece
di contraddirle — sei battute sono sei slide — e
`checkRubricsAndBatchFeasibility` rifiuta un carosello che arriva senza, così
l'agente lo ripara prima di spendere un render.

**`Rubric.art_direction`** — lo stile visivo era UNO per brand, sintetizzato dal
sito. Una rubrica aveva nome, promessa, ruolo, formato e cadenza: nessuna
grammatica visiva. Quindi "carosello a fumetti" non era esprimibile — anche
nominandolo, il renderer disegnava com'era fatto il sito, e i fallback erano
cablati su `Photorealistic`. Ora la serie dichiara il suo medium, e
`applyRubricToSeed` lo stampa su ogni episodio: viaggia col seed, perché il
produttore e il renderer non leggono le rubriche. Sul seed batte il
`visual_style` del brand — è l'unica cosa che permette a due serie dello stesso
brand di avere due registri visivi diversi.

Scartato: un `visual_style` per rubrica in tabella a parte (una tabella per un
campo di testo), e la scelta di far scrivere le battute al copywriter nel pass 2
— là la storia non è visibile a chi approva, che è metà del punto.

Non toccato: il prompt dello stratega si presenta ancora come «senior
social media strategist at an agency» con PRODUCT VARIETY e VIDEO FIRST. Per un
brand senza prodotto ogni leva spinge dalla parte sbagliata, ma è una riscrittura
a sé, non un campo.

La sonda `npm run eval:creative` gira il percorso vero su un brand editoriale
finto e scrive rubriche, piano, post e slide renderizzate in `eval-results/`:
serve a guardare quello che esce, che è l'unica misura che il difetto avesse.
