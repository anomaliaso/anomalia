# Il budget decide, e i prezzi vengono da un posto solo

Il volume di una settimana lo decidevano tre soffitti impilati, nessuno derivato da
quello che il brand paga: l'enum delle cadenze, un tetto di 14 post a settimana scritto
a mano, e la quota di post. Peggio: erano legati fra loro, perché il prompt del piano
imponeva che il `content_mix` sommasse alla cadenza. Un tetto sul ritmo era quindi un
tetto sul volume, e un Pro che paga 90 post al mese ne vedeva pianificati 28.

Ora non c'è nessun numero scritto. Il piano riceve **i crediti della settimana e il
listino**, e dimensiona il mix su quello che comprano — «una settimana con una lunga
storia illustrata e due post corti può valere più di sei post intercambiabili» — mentre
il gate di fattibilità rifiuta un batch che non si può produrre. La cadenza torna al suo
mestiere: come la settimana è sparsa sui giorni, mai quanta ce n'è. E non è più gated
dal piano, perché limitare il ritmo non protegge più niente da quando il volume non ci
pende sopra.

**I crediti dei piani derivano dal prezzo.** Erano tre cifre a mano — 2100 / 5500 /
12000 — con margini impliciti che nessuno aveva scelto: 28% su Go, 38% su Starter, 47%
su Pro. Ora sono prezzo × (1 − margine), col margine dichiarato una volta (50%, 40% su
Go perché è il piano d'ingresso): **1740 / 4450 / 11250**. La pagina prezzi e
l'entitlement leggono lo stesso campo, e un test li tiene insieme — cambiare un prezzo
senza i crediti fallisce invece di mostrare al cliente un numero e concedergliene un
altro.

**E i prezzi vengono da un posto solo.** `plans.ts` aveva la sua tabella (video $0.41,
immagine $0.184) su cui erano dimensionate le quote; nessuna delle due cifre era
misurata. `mixCostUsd` ora chiede a `content-cost.ts`.

**Quello che quella misura rivela, e che resta da decidere:** un mese del mix costa il
**7-9%** dei crediti di un piano, non il ~33% che la vecchia tabella lasciava credere.
La quota di post è circa dodici volte più stretta del budget, e le due non sono mai
state riconciliate perché i prezzi sbagliati nascondevano lo scarto. Togliere la quota
del tutto — «il budget è il limite» — moltiplicherebbe la spesa fino a quel fattore: è
una decisione di listino, non di codice, e va presa guardando questi numeri.

Chiuso anche il guasto che rendeva tutto questo teorico: `generateObject` e
`generateText` non avevano scadenza. Il modello di default risponde in 2 secondi a un
prompt semplice e tiene la connessione aperta 180 secondi senza contenuto in modalità
strutturata — 200, soli spazi di keep-alive. Ora scadono a quattro minuti.
