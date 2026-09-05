# `list_products` rientra dentro `query`, e il perimetro passa da 22 a 6

Il piano in `docs/mcp-tools.md` dice ventidue letture: una tabella e un filtro,
`query` le fa già. Questo è il primo pezzo eseguito — uno solo, di proposito, per
misurare il metro prima di applicarlo diciannove volte.

Il metro ha retto e il perimetro no: **delle ventidue, sei sono davvero
`select … from una_tabella`.** Le altre sedici fanno qualcos'altro, e il
documento le aveva classificate leggendo le descrizioni invece delle rotte.

## Cosa è stato tolto

`list_products` da `BRAND_ENDPOINTS`. La rotta `GET
/api/v1/brands/:slug/products` resta viva: `anomalia products` la chiama, e
togliere una entry dal registro non cancella un file scritto a mano.

Un agente che cerca cosa vende il brand ora legge `products` con `query`, e ne
riceve **più** di prima: `list_products` mappava `images` in `imageCount` e
buttava via l'array. `get_studio` continua a restituire gli stessi prodotti con
i loro id, che è il motivo per cui `studio.ts` non ha più bisogno di nominare
due sorgenti per lo stesso id.

## Le due che sono state fermate prima di scrivere codice

Andrea ne aveva indicate tre, «le più semplici e più usate». Due non lo erano.

**`get_memory` non si tocca, e non è una questione di forma: è una fuga.** La
rotta applica due filtri che la riga non porta —
`loadMemoryEntries(..., { agent: null })` diventa `.is('agent', null)` e
`.neq('layer', 'session')`. `query` su `brand_memory` restituisce entrambe le
categorie, e la RLS non lo impedisce perché quelle righe **sono** del brand: il
filtro è una regola di prodotto, non un permesso. La sostituzione consegnerebbe
a un agente le note di mestiere di altri agenti e i fatti di una singola
conversazione, presentati come conoscenza del brand. Nessuna riga di
`findability` lo avrebbe visto: le parole combaciano tutte.

**`get_plan` legge quattro tabelle e ne calcola due valori che non esistono in
nessuna colonna.** `getEditorialPlan` prende `editorial_plans` due volte (attivo
e proposto), `brand_usage` e `brands`, poi calcola `currentWeek` con
`currentWeekIndex()` sul fuso del brand e `quota.remaining` con
`postQuota(piano)`. `query` è una tabella per chiamata: diventerebbero quattro
chiamate più un calcolo di date rifatto nel prompt. Non è unificare, è spostare
lavoro dentro il modello.

## La classificazione vera delle ventidue

Letta dall'implementazione, non dalla descrizione:

| | tool |
|---|---|
| **una tabella e un filtro** (6) | `list_posts`, `list_articles`, `list_ideas`, `get_audit_findings`, `get_keywords`, `list_products` |
| **compongono** (14) | `list_shares`, `list_web_audits`, `list_web_fixes`, `list_audit_citations`, `get_article`, `get_calendar`, `get_bio`, `get_voice`, `get_gtm`, `get_weekly_plan`, `get_ranks`, `get_goals`, `get_market_field`, `check_media_job` |
| **regola di prodotto / di piano** (2) | `get_memory`, `get_plan` |

Qualche esempio di cosa vuol dire «compongono», perché il confine non è
teorico: `get_voice` calcola `studioPct` da tre `count` esatti; `get_calendar`
fonde tre letture di `posts` e conia `monthLabel`/`prevYM`/`nextYM`;
`get_bio` incrocia `social_accounts` e `post_links` per scegliere il link più
cliccato in sette giorni; `get_ranks` fa una seconda query per parola chiave e
ne ricava il `delta`; `check_media_job` inventa uno stato
(`CLIP_NOT_IN_LIBRARY`) che nessuna colonna contiene.

Il conto del documento va corretto: −6 letture, non −22. Il grosso della
riduzione resta nel CRUD e nelle impostazioni.

## Il vincolo che nessuno aveva scritto

**`query` rifiuta il percorso a chiave API.** `authenticate` restituisce un
client service-role sul percorso `anomalia_`, e `createQueryTool` pretende un
client marchiato `isRlsScoped`: un tool che «a volte legge tutto» sarebbe
peggio di uno che a volte non c'è.

Quindi «il tool non c'è più, usa `query`» è vero su MCP (solo OAuth Bearer) e
sulla CLI loggata (JWT), **mai** per un chiamante REST con una chiave API. È la
ragione per cui ogni rimozione deve lasciare in piedi la sua rotta, e per cui il
guard qui sotto non è un dettaglio.

## Il guard: una rotta senza contratto si dichiara

`registry.test.ts` aveva quattro prove e tutte e quattro andavano dal registro
alla rotta. Nessuna faceva il contrario. Togliere una entry non faceva fallire
niente: la rotta restava viva, raggiungibile e senza più nessun posto dove è
descritta.

Una volta è una curiosità. Venti volte è una superficie che nessuno può
elencare. La prova nuova cammina l'albero delle rotte e pretende che ognuna sia
o descritta da un contratto o dichiarata in `REST_ONLY` — ventotto c'erano già
prima di questo lavoro, la ventinovesima l'ha creata questa rimozione.

La lista non porta un motivo per riga: ventotto motivi inventati sarebbero
peggio del silenzio. Quello che impone è che la riga si aggiunga a mano, in un
diff che qualcuno legge, con la domanda davanti — **questa rotta cos'è adesso,
se non è più un tool?** Superficie REST voluta, o codice morto da cancellare.
Il conto di quelle due risposte dice di più, sulla decisione, del conto delle
rimozioni.

## Il cancello

`findability.test.ts` ha una riga in più, scritta da chi possiede il test e non
da chi ha fatto la modifica: «what does this brand sell» deve trovare `query`.
Rossa prima (su entrambe le superfici — descrizione e skill), verde dopo.
`table` era stato proposto come terza parola ed è stato rifiutato perché non può
fallire da solo: la riga `query` che c'era già lo asserisce.
