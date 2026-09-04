# Correzione al censimento dei tool scritti a mano

Il censimento dei tool MCP ancora scritti a mano li divideva in gruppi per il motivo che li
teneva fuori dal registry. Un gruppo era sbagliato, e chi rifarà quel conto deve trovare la
classificazione giusta invece di ripetere l'errore e scoprirlo a metà lavoro.

**I cinque tool sugli articoli erano nel gruppo «rimodellano l'input», cioè un campo rinominato o
un valore normalizzato dal client.** Non lo erano. `generate_article`, `optimize_article`,
`publish_article`, `unpublish_article` e `delete_article` erano bloccati dalla stessa cosa dei
quattro su `/posts/:id/media`: **un `action` costante nel corpo**. Una rotta sola che si dirama su
un campo, e il contratto che deve dichiarare la forma di quel corpo senza poter dichiarare la
costante.

La differenza conta perché cambia la correzione. Un campo rinominato si risolve in una riga —
la rotta accetta anche il nome che il tool usa. Un `action` costante non si risolve così: o si
inventa un meccanismo per i campi costanti nel contratto, che rende dichiarabile lo `switch`
invece di toglierlo, o **si spezza la rotta**. Chi legge «rinomina» stima un'ora e ne trova
cinque.

Il conteggio del gruppo tornava lo stesso (13), ed è per questo che l'errore non si è visto
subito: contare giusto non vuol dire classificare giusto.

Il numero corretto del gruppo `action` costante era **dieci**: quattro su `/posts/:id/media`,
cinque su `/web`, e `generate_person`, che deve mandare `kind: 'ai'` a `/studio/people`. Le prime
nove sono state sistemate spezzando le due rotte. `generate_person` resta, ed è l'ultimo della
famiglia.

Altre due voci del censimento erano sbagliate, e sono corrette nei changelog che le riguardano:
`edit_post` non era «più di una chiamata» e `get_dashboard` non aveva bisogno di un secondo
registro.
