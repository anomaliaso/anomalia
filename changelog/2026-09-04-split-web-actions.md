# Ogni azione sugli articoli ha la sua rotta

`POST /web` faceva cinque cose a seconda di un campo `action`: generare una bozza, riscriverla per
la SEO, pubblicarla, depubblicarla, cancellarla. Cinque rami dentro un handler, con due regimi
diversi di gate — `generate`/`optimize` passano dai crediti, le tre di stato no — decisi dentro
gli `if`.

`CLAUDE.md` vieta questa forma: *«mai condizioni sparse, singole o concatenate… un `if` su un caso
particolare, poi un altro, poi un terzo, è un registro che non è mai stato scritto»*. Il registro
c'è, è `BRAND_ENDPOINTS`, e questa rotta non poteva entrarci: il contratto dichiara la forma del
corpo, e qui il corpo doveva contenere la costante che sceglie il ramo. È lo stesso motivo per cui
`/posts/:id/media` è stata spezzata.

Ora sono cinque rotte, e i cinque tool sono cinque entry del registry. Il gate non è più una
condizione: `/web/generate` e `/web/article/:id/optimize` lo chiamano, le altre tre non ce l'hanno
proprio.

**La vecchia rotta resta** e non fa altro che inoltrare — `action` sceglie a quale, `id` passa dal
corpo al percorso dove già stava. L'API pubblica non si rompe e chi la chiama oggi, CLI compreso,
continua a funzionare.

`cli/mcp/tools/web.ts` sparisce: conteneva solo questi cinque tool e `ads_action`, migrato prima.

**Un cambio di comportamento, dichiarato**: `delete_article` è `DELETE /web/article/:id`, e per la
regola introdotta con le altre quattro cancellazioni una DELETE non risolve mai un prefisso. Vuole
l'UUID pieno, e la sua descrizione lo dice — *«Delete a blog article by UUID»* — invece di
promettere un prefisso che non accetta più. Va nel changelog pubblico.

Scartato: `openWorld: true` su `generate_article` e `optimize_article`. È vero che entrambe
chiamano un modello con grounding, ma i tool a mano non lo dichiaravano e nemmeno `propose_plan` o
`seo_action` lo dichiarano: è una revisione da fare in una volta su tutti gli endpoint AI, non un
delta che si intrufola dentro una migrazione. La cattura di `tools/list` l'ha preso.

Equivalenza provata: `tools/list` attraverso `handleMcpFetch` prima e dopo. 116 tool prima, 116
dopo, nessuno aggiunto, rimosso o duplicato. Un solo delta oltre a `additionalProperties: false` e
alla descrizione di `id`: `delete_article`, quello dichiarato qui sopra.
