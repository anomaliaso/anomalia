# Ogni azione sui media di un post ha la sua rotta

`POST /posts/:id/media` faceva quattro cose a seconda di un campo `action`: rifinire la copertina,
rifare una slide, riordinare le slide, animare un video. Quattro `if` in fila dentro un handler.

`CLAUDE.md` vieta esattamente questa forma: *«mai condizioni sparse, singole o concatenate… un
`if` su un caso particolare, poi un altro, poi un terzo, è un registro che non è mai stato
scritto»*. Quel registro c'era già — è `BRAND_ENDPOINTS` — solo che questa rotta non poteva
entrarci: il registry dichiara la forma del corpo, e qui il corpo doveva contenere una costante
che sceglie il ramo. Un meccanismo per i campi costanti nel contratto renderebbe la cosa
dichiarabile senza toglierla: nascondere il problema, non risolverlo.

Ora sono quattro rotte, una per azione, e `regenerate_post_media`, `regenerate_slide`,
`reorder_slides` e `make_video` sono quattro entry del registry. `/media/order` renderizza
niente e non passa dal gate crediti, come prima; le altre tre lo fanno da sole.

**La vecchia rotta resta**, e non fa altro che inoltrare: `action` sceglie a quale delle quattro,
e nient'altro accade lì. L'API pubblica non si rompe, `docs/api/03-posts.md` resta vero, e chi la
chiama oggi — il CLI compreso — continua a funzionare. Le rotte nuove sono la strada, quella
vecchia è compatibilità, e la documentazione lo dice.

Il test che c'era leggeva il *sorgente* della rotta per estrarre le azioni implementate e
confrontarle con quelle che i chiamanti spediscono — un controllo su stringhe nate da un difetto
vero (`action: 'reorder'` prendeva 400 da sempre). Sostituito con lo stesso controllo fatto
chiamando: le quattro azioni arrivano dove arrivavano, e una che non esiste resta un 400 e non un
silenzio.

`postMediaTarget` in `src/lib/server/post-media.ts` è l'auth + contesto editor che tutte e cinque
usano: era una funzione locale della rotta, ora è condivisa invece di copiata quattro volte.

Equivalenza provata: `tools/list` catturato attraverso `handleMcpFetch` prima e dopo. 116 tool
prima, 116 dopo, nessuno aggiunto o rimosso, nessun duplicato. I quattro migrati tengono nome,
titolo, descrizione, tipo e vincolo di ogni proprietà, obbligatori e annotazioni. L'unico delta è
che `id` guadagna la descrizione `"Post id or unambiguous prefix"` (più `additionalProperties:
false`): il prefisso lo accettavano già, semplicemente non lo dicevano — e ora lo dicono come
ogni altro tool sui post che dal registry ci passa già.
