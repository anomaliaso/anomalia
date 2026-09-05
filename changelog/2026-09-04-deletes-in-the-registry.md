# Le quattro cancellazioni passano dal registry, e prendono l'UUID pieno

`delete_person`, `delete_document` e `delete_competitor` erano tre tool MCP scritti a mano in
`cli/mcp/tools/studio.ts`: esistevano solo lì. Il CLI le fa per conto suo, la rotta REST le
espone da sempre, e Web MCP — il quarto consumatore in arrivo — non le avrebbe mai viste. Ora
sono tre entry di `BRAND_ENDPOINTS`, come le altre ottanta: una dichiarazione, tutti i
consumatori.

La trappola stava nel generatore. Per un endpoint con `:id` sostituiva l'id dichiarato dal
contratto con una stringa risolta per prefisso — comodo per leggere e per correggere, perché la
lista dice quale riga è e il prefisso basta a indicarla. Su una cancellazione no: un prefisso
ambiguo colpisce la riga sbagliata e non c'è modo di annullare. Migrandole così, tre tool che
oggi chiedono un UUID avrebbero cominciato ad accettare `3f1c`, e la loro descrizione — *"Delete
a studio person by UUID"* — sarebbe diventata falsa.

Si è chiuso dalla parte stretta: **la DELETE non risolve mai un prefisso**. La regola sta in un
posto solo, `acceptsIdPrefix` in `packages/api-contracts/src/index.ts`, accanto al modello che
governa — così il generatore MCP e chiunque arrivi dopo la leggono da lì invece di riscriverla.
`delete_product`, che il prefisso lo accettava, ora vuole l'UUID pieno come le altre tre: è
l'unico cambiamento di comportamento visibile, e va nel changelog pubblico.

`BRAND_RESOURCES` guadagna `document`, e con esso il resolver per prefisso dei documenti in
`cli/mcp/util.ts`: oggi nessuna rotta lo usa (l'unico endpoint sui documenti è una DELETE), ma
la mappa dei resolver è totale sulle risorse e la riga costa meno del `Partial` più la guardia
che servirebbero a evitarla.

Equivalenza provata, non dichiarata: `tools/list` catturato attraverso `handleMcpFetch` prima e
dopo. 112 tool prima, 112 dopo, nessuno aggiunto o rimosso. I tre migrati hanno nome, titolo,
descrizione, proprietà e obbligatori identici; l'unico delta è `additionalProperties: false`,
che arriva perché gli input del registry sono `.strict()`.
