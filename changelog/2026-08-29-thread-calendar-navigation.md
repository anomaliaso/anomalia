# Ripristina la modal dopo una pagina full-width

Dal thread, Social media apriva il calendario nella `PageModal` senza cambiare
URL. Un clic su un post usciva correttamente verso la pagina full-width, ma la
modal veniva chiusa e il ritorno lasciava il calendario come pagina principale.
I link di ritorno dei post e degli articoli puntavano sempre al calendario o al
blog, quindi perdevano il thread sottostante.

La modal ora conserva l’URL della superficie che la ospita, resta nascosta
durante le pagine full-width e si riapre quando quella superficie torna attiva.
L’origine è condivisa con le pagine full-width: i ritorni di post e articoli
riportano al thread originario, mentre un deep-link senza origine mantiene il
fallback esistente. Navigare verso un’altra pagina modal invalida l’origine
precedente, evitando ritorni a contesti ormai vecchi.

La regola vive in un helper testato e in uno store client, non in condizioni
duplicate dentro ogni pagina. Sono coperti calendario → post full-width → thread,
il ritorno esplicito e il fallback del deep-link.
