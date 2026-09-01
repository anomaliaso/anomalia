# Le date dei test si derivano dall'orologio, non si scrivono

Due test passavano `scheduled_for: '2026-09-01T10:00'` chiamandola «una data futura». Alle 10:00
dell'1/9/2026 è diventata passato, i tool l'hanno rifiutata — correttamente — e la suite è
diventata rossa su ogni branch del repository nello stesso minuto, senza che nessuno avesse
toccato una riga.

`aDateInTheFuture()` vive nel testkit che entrambi i file già importano: la data si calcola da
`Date.now()`, così non può invecchiare.

Scartato: **spostare la data più in là** (2027, 2030). È lo stesso difetto con la miccia più
lunga, e la prossima volta esplode addosso a qualcun altro senza il contesto per riconoscerlo.

Scartato: **congelare l'orologio nei due test** con i fake timer. Avrebbe funzionato, ma questi
test non parlano del tempo: chiedono «una data futura», e il modo onesto di dirlo è calcolarla.

La lezione sta in `LESSONS.md`, insieme al segnale che la fa riconoscere — «era verde stamattina e
non ho cambiato niente», con i file rossi lontani dal proprio diff.
