# `search_knowledge` — l'agente esterno interroga la conoscenza del brand

## Cosa c'era prima

L'agente interno cercava dentro i documenti del brand con `searchKnowledge`
(`src/lib/server/knowledge.ts`): FTS su `brand_doc_chunks`, e in fusione RRF con i vicini
vettoriali quando le parole chiave non bastano. Da fuori, via MCP, quella capacità non esisteva:
i 115 tool del registry toccavano la conoscenza solo con `get_studio`, che elenca i documenti —
dice **quali** ci sono, non cosa contengono.

Un agente esterno che doveva scrivere qualcosa di fondato aveva due sole strade: chiedere
`get_studio` e ricevere il `content_text` di ogni documento (l'intero corpus riversato nella
finestra), oppure inventare.

## Cosa cambia

Una rotta sola, `GET /api/v1/brands/:slug/knowledge/search`, sopra la `searchKnowledge` che
esisteva già. Nessuna riscrittura della ricerca: la rotta risolve il brand, passa la domanda e
formatta i passi.

Il tool MCP `search_knowledge` nasce dal registry (`packages/api-contracts/src/knowledge.ts`),
come tutti gli altri.

## Le due domande decise prima di progettare

**Costa?** Quasi mai, e mai un modello generativo. `searchKnowledge` interroga prima l'FTS —
Postgres puro, zero chiamate. Un embedding della domanda parte **solo** quando l'FTS restituisce
meno risultati del `limit`; è un embedding corto, non una generazione, e finisce in `ai_calls`
come `knowledge-embed`.

Per questo la rotta **non** passa da `gateAiAction`: il corpus è già stato indicizzato — e pagato —
al momento dell'ingestione. Mettere un cancello a crediti su una lettura significherebbe che un
brand a secco non può più leggere quello che ha già pagato per indicizzare. Il prezzo è comunque
dichiarato nella descrizione del tool, che è l'unica documentazione che un modello legge prima di
chiamare.

**Quanto restituisce?** Un chunk nasce a ~800 token (~3.200 caratteri). Otto chunk interi sono
~25.000 caratteri per una domanda sola. Due tetti, entrambi nel contratto e verificati da un test:

- `KNOWLEDGE_HITS_DEFAULT = 6`, `KNOWLEDGE_HITS_MAX = 20` — `limit` sopra il tetto è rifiutato da
  zod prima di partire, e la rotta lo riapplica per chi chiama in HTTP diretto;
- `KNOWLEDGE_EXCERPT_CHARS = 1500` per passo, con `truncated: true` quando c'è dell'altro. Il
  `documentId` dice dove andarlo a prendere.

## L'isolamento fra brand, e perché ha un test dedicato

Sul percorso a chiave API `authenticate` restituisce il **client di servizio**: la RLS non
protegge niente. L'unico filtro è `p_brand` dentro `search_brand_chunks`, e il brand arriva da
`loadBrandForUser`, mai da un parametro di chi chiama.

Questo repo ha già avuto una lettura che attraversava tutti i brand di un utente con la suite
verde, quindi il test è scritto per fallire davvero: il finto Supabase imita il SQL vero
(filtra per `p_brand`) ed è seminato con due brand. Il test cerca **il contenuto esatto** del
documento dell'altro brand e pretende zero risultati; un secondo test verifica che ogni RPC parta
con il brand risolto dallo slug anche quando chi chiama prova a passarne un altro.

## Cosa è stato scartato

- **`documentIds` come parametro.** `searchKnowledge` lo accetta, ma un agente esterno non ha
  modo di sapere quali id gli servono prima di aver cercato. Si aggiunge quando serve davvero.
- **Restituire il chunk intero.** Il passo tagliato più il `documentId` costano meno del corpus
  intero e dicono la stessa cosa.
