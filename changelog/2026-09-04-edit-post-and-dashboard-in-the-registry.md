# `edit_post` e `get_dashboard` entrano nel registry, e restano fuori in due

Due tool erano classificati come non migrabili. La verifica dice altro.

**`edit_post` era «non è una chiamata sola».** Non è vero: `api.updatePost` è `PUT /posts/:id`,
una chiamata. Quello che il tool faceva prima — risolvere il prefisso dell'id in un id pieno — è
esattamente quello che il generatore fa già per ogni endpoint di risorsa, da `update_product` a
`reschedule_post`. Non era una seconda chiamata: era la stessa che il registry fa per tutti.

La differenza vera stava nella risposta. Il tool a mano rispondeva `{ok, id, patch}` dove `patch`
era l'eco dell'input: gli stessi campi che gli avevi mandato, rimandati indietro. Un agente
esterno può leggerlo come conferma di *cosa è stato scritto*, e non lo è — un campo che la rotta
non conosce ci finiva dentro identico. Ora è la rotta a restituirlo, e restituisce `updates`:
quello che ha scritto davvero, filtrato sui campi che sa applicare. Stessa chiave, stesso numero
di campi nella risposta, e finalmente una conferma invece di un'eco.

**`get_dashboard` era «fuori da `/brands/:slug/`».** Sta esattamente sul brand: `GET
/api/v1/brands/:slug`. Con `pathUnderBrand` vuoto, il `pathFor` che c'è già produce quell'URL, e
il test delle rotte risolve `src/routes/api/v1/brands/[slug]/+server.ts`, che esiste ed esporta
`GET`. Nessuna macchina nuova.

L'invariante «ogni path parte da `/`» diventa «parte da `/`, oppure è vuoto». Serviva a prendere
lo slash mancante, che incolla il segmento allo slug (`posts` → `/api/v1/brands/demoposts`): il
path vuoto non incolla niente perché non c'è niente da incollare. Il test lo dice, e continua a
bocciare il caso per cui esiste.

**Quindi il registro per gli endpoint non-brand non serve.** Restava una domanda da due endpoint,
ed era da uno: `list_brands`, `GET /api/v1/brands`, che un brand sotto cui stare non ce l'ha.
Resta a mano, con la ragione scritta accanto in `cli/mcp/tools/auth.ts`. Se un giorno gli endpoint
fuori dal brand diventano tre o quattro, la domanda si riapre da sola.

Equivalenza: `tools/list` catturato attraverso `handleMcpFetch` prima e dopo. 121 tool prima, 121
dopo, nessuno aggiunto, rimosso o duplicato. `edit_post` identico in tutto. `get_dashboard`
guadagna `destructiveHint: false`, che il generatore mette a ogni endpoint e che ogni altra
lettura del registry ha già — su una lettura non dice niente di nuovo, `readOnlyHint: true` lo
diceva già.
