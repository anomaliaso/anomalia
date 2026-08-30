# La ricarica mostra il parziale al primo render, non dopo il poll

Segnalazione secca: *«vedere un aggiornamento ogni 4s oppure non essere sicuri che lo si veda
neppure è decisamente incompleto»*. Aveva ragione, e il difetto era mio, lasciato nella PR #89.

Il testo in corso di scrittura **finisce** nel log durevole ogni 250ms. Ma `threadMessageRows`
proiettava solo gli eventi `message` e **buttava via i `progress`**, e il client partiva con la
proiezione vuota. Risultato: al reload la pagina mostrava meno di quanto il database avesse già,
e il parziale ricompariva solo al poke successivo o col poll a 4 secondi del vecchio specchio.

## Una funzione sola, come da loro

Il metro è [rakazo](https://github.com/elie222/rakazo), dove il carico a freddo rigioca il log
INTERO — progress compresi — con lo stesso riduttore del tail live: *«il messaggio parziale che
una scheda nuova vede a metà stream è identico byte a byte a quello che una scheda viva sta
accumulando»*. Da noi le due strade divergevano, e una divergenza fra due percorsi che dovrebbero
dire la stessa cosa non si corregge: si toglie.

`threadProjectionRows` restituisce messaggi, istantanee per `runId` e cursore.
`threadMessageRows` ora **delega** a lei. Non c'è più un secondo posto in cui la proiezione possa
comportarsi diversamente.

## Il primo render, non il primo poll

Non bastava. Il rendering della bolla viva è appeso a `orphanRun`, che il client seminava da solo
in modo asincrono: la proiezione era pronta e non aveva dove essere disegnata. Ora il run vivo
arriva col caricamento della pagina (`loadLiveRun`, la stessa lettura di `kit-run/+server.ts`
spostata dove serve), quindi la bolla esiste al primo render e il testo ci finisce dentro subito.

I test di `loadLiveRun` pinnano anche i due casi che contano: un run col battito fermo non produce
una bolla per un cadavere, e un run finito non si mostra.

## Cosa resta

Questo è lo **stadio 1** della conversione decisa in
[ADR 0005](../docs/adr/0005-the-browser-follows-the-log.md): rendere il log sufficiente a guidare
la UI da solo. Lo streaming dalla richiesta, i due specchi `partial`, `ChunkPosition` e il poll a
4s sono ancora tutti al loro posto — si tolgono allo stadio 3, uno alla volta, ognuno con lo
scenario che avrebbe preso la sua perdita.

E il motore di eval col browser, quello che dovrebbe misurare proprio questa ricarica a metà
stream, non esiste ancora: l'ADR lo mette come vincolo PRIMA di spegnere lo streaming, non dopo.
Quindi questa correzione è provata dai test e dal ragionamento, non da un browser.
