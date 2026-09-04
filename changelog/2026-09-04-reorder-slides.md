# `reorder_slides` mandava un'azione che non è mai esistita

Il tool MCP spediva `action: 'reorder'` a `POST /api/v1/brands/:slug/posts/:id/media`, che conosce
`restructure | regenerate | slide | video` e risponde `400 Unknown action: reorder`. Non ha mai
funzionato in nessuna versione: il ramo che avrebbe dovuto servirlo non è mai stato scritto con
quel nome.

**Il riordino esiste, ed è già implementato.** `restructureCarouselSlides` in
`post-editor-tools.ts` riordina ed elimina le slide senza renderizzare niente; la chiama la chat
(`restructure_carousel`), la chiama la rotta (`action: 'restructure'`), e la chiama il comando
`anomalia post <slug> <id> reorder`, che infatti manda la stringa giusta. L'unico chiamante
sbagliato era il tool MCP. Quindi la riparazione onesta non è togliere il tool — la capacità c'è,
e due chiamanti su tre la usano — è mandargli la stessa azione che manda la CLI.

**La correzione è una parola.** Il test che la accompagna, no: il difetto non è "questa stringa è
sbagliata", è "nessuno controlla queste stringhe". Fra chiamante e rotta il contratto è un
letterale, e un letterale nessun compilatore lo verifica; sono passati mesi con un tool che
rispondeva 400 a ogni invocazione senza che una riga rossa lo dicesse. Il test raccoglie le azioni
che i chiamanti (`cli/mcp/tools/brand-content.ts`, `cli/commands/post.ts`) spediscono e le
confronta con quelle che la rotta implementa: la prossima azione inventata muore in CI, non in
produzione.

**Scartato: insegnare `reorder` alla rotta come alias.** Sarebbe stato un secondo nome per la
stessa cosa, con la CLI a mandarne uno e MCP l'altro — cioè lo stesso disallineamento di prima,
solo funzionante per caso finché qualcuno non tocca uno dei due rami.

**Scartato: rimuovere il tool.** Era l'esito giusto solo se il riordino non esistesse da nessuna
parte. Esiste, ed è raggiungibile da chat e da CLI: toglierlo avrebbe tolto a un agente esterno
l'unica capacità che gli altri due chiamanti hanno già.

**Scartato: un test che invoca il tool via il transport MCP.** Avrebbe richiesto di montare
`handleMcpFetch` con un token e uno stub di rete per una singola stringa, e avrebbe coperto un
tool solo. Il test sui letterali costa venti righe e copre tutti e quattro.
