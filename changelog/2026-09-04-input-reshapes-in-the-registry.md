# Sei tool scritti a mano passano dal registry, senza cambiare forma

`save_brief`, `replan_week`, `plan_week`, `add_note`, `set_colors` e `ads_action` erano sei tool
MCP scritti a mano. Il motivo per cui erano rimasti fuori non era la rotta: era che la forma del
tool non era la forma del corpo che la rotta legge.

- la settimana: il tool la chiama `week`, la rotta `week_index`
- la nota: il tool la chiama `text`, la rotta `content_text`
- i colori: il tool accetta `7c5cff`, la rotta pretendeva `#7c5cff` — il cancelletto lo metteva
  il client
- gli annunci: il tool raccoglie i campi propri dell'azione in `extra`, il client li spianava in
  cima al corpo prima di spedirlo

Ogni volta la traduzione viveva in `cli/mcp/tools/`, cioè in un consumatore solo: il CLI la
rifaceva a modo suo, e Web MCP non l'avrebbe vista affatto.

**Ha ceduto la rotta, non il tool.** `week_index` resta il nome documentato e continua a
funzionare; accanto, la rotta accetta `week`. Lo stesso per `content_text`/`text`. I colori li
normalizza la rotta invece del client — `7c5cff` e `#7c5cff` sono lo stesso colore, e ora lo sono
per chiunque chiami l'API, non solo per chi passa dall'MCP. `/ads` appiattisce `extra` una volta
sola in cima all'handler, dove prima ogni chiamante decideva da sé.

L'alternativa era rinominare i campi del tool (`week` → `week_index`, `text` → `content_text`),
che allineerebbe i nomi ovunque ed è più pulita a lungo termine. È stata scartata qui perché
cambia dei tool che gli agenti già usano: è una decisione da prendere apposta, non l'effetto
collaterale di una migrazione.

Equivalenza provata, non dichiarata: `tools/list` catturato attraverso `handleMcpFetch` prima e
dopo. 113 tool prima, 113 dopo, nessuno aggiunto o rimosso. I sei migrati hanno nome, titolo,
descrizione, proprietà, obbligatori e annotazioni identici; l'unico delta è
`additionalProperties: false`, che arriva perché gli input del registry sono `.strict()`.
