# Due agenti che «dicono le stesse identiche cose»

Riportato dopo un onboarding: l'Analyst scrive a Content Creator e a Web Specialist, i due
compaiono in sidebar, e aprendoli **riportano gli stessi identici 3 messaggi** — quelli del
Content Creator.

Sul database non è vero. Le due conversazioni hanno il loro seed, la loro riga di apertura e il
loro errore di ripresa, distinti (verificato in produzione sul brand del report e riprodotto uguale
in locale). Quello che si vede è la SCHERMATA, e la schermata ha due orologi:

- la **testata** cambia al clic — nome e faccia arrivano dallo store dei thread, che è già in
  memoria;
- il **transcript** cambia a load finita — i messaggi arrivano dal server, e la load di un thread
  sono dieci letture.

In mezzo la pagina afferma una cosa falsa: il nome dell'agente NUOVO sopra la conversazione di
quello di PRIMA. Con due specialisti appena presentati, che si somigliano per costruzione, sembra
esattamente che stiano dicendo la stessa cosa. In locale la finestra è di frazioni di secondo; in
produzione dura quanto la load, e la load è la parte lenta.

Lo scheletro della chat c'era già e veniva saltato per QUALUNQUE destinazione-thread. La ragione
del salto era una sola e riguarda un altro percorso: Panoramica → thread, dove la Panoramica È il
composer e uno scheletro smonterebbe l'invio in volo, facendo sparire il turno appena spedito.
Thread → thread non ha quel problema e ha il problema opposto. L'eccezione ora nomina il caso che
la giustifica, invece di valere per tutti.

La regola è uscita dai due `$derived` del layout: sta in `$lib/shell-nav`, dove si legge tutta
insieme e ha dei test — Panoramica → thread niente scheletro, thread → thread sì, stesso thread no.
Era proprio l'illeggibilità a nascondere il caso costoso dentro un'eccezione scritta per un altro.
