# Le chat del brand di prima, nella sidebar del brand nuovo

Riportato: si crea un brand da uno che ha già delle chat, e nella sidebar del brand appena nato
compaiono le conversazioni di quello di prima. Spariscono «dopo un po'» — cioè quando arriva la
lista vera.

`chatThreads` è UNO store per tutta la shell, e niente lo legava al brand di cui contiene la lista.
Chi la ripuliva erano due posti, e nessuno dei due copre questo passaggio:

- `beforeNavigate` in `app/[brand]/+layout.svelte` confronta lo slug di partenza con quello di
  arrivo — creando un brand si passa da `/app/onboarding`, che uno slug non ce l'ha, quindi il
  confronto non scatta né all'andata né al ritorno;
- l'effect di `DashboardSidebar` confronta con il brand del render precedente, ma su quel percorso
  la sidebar si SMONTA (rotta fuori dalla shell del brand) e si rimonta senza un brand di prima —
  mentre lo store, che vive nel modulo, la sopravvive intatto.

Il confronto ora sta dove passano tutti: `refreshThreads(slug)` ricorda di che brand è la lista che
ha in memoria e, se gliene chiedono un'altra, butta quella vecchia PRIMA di partire con la fetch.
Un solo posto, e vale per qualunque strada porti a un brand diverso — non solo per la creazione.

Alla sidebar resta il compito che è suo e solo suo: mollare il thread aperto quando il brand cambia
davvero (mai al primo mount, o un deep link a una chat verrebbe cancellato prima che ChatColumn si
allinei all'URL).
