# Le scritture dello studio arrivano all'agente esterno

Il piano `docs/external-agent-plan.md` segna quattro righe della *Brand foundation* come
**Bridge** — creare/modificare/togliere prodotti, modificare persone, modificare competitor,
leggere e scrivere la bio pubblica. Bridge nel piano ha una definizione precisa: *"Exists in
Anomalia REST or web UI and needs MCP exposure"*. Verificata riga per riga contro il codice, la
mappa è questa:

| Riga del piano | REST prima di questa PR | Tool MCP prima | Buco vero |
|---|---|---|---|
| Creare un prodotto | **nessuno** | nessuno | endpoint **e** tool |
| Modificare un prodotto | `PUT /products/:id` | nessuno | solo il tool |
| Togliere un prodotto | `DELETE /products/:id` | nessuno | solo il tool |
| Modificare una persona | `PUT /people/:id` | nessuno | solo il tool |
| Modificare un competitor | `PUT /studio/competitors/:id` | nessuno | solo il tool |
| Leggere/scrivere la bio | `GET`/`PUT /bio` | nessuno | solo il tool |

Cinque endpoint su sei esistevano già e sono documentati. **Non ne è stato scritto un secondo per
nessuno**: un endpoint doppio è un debito che si paga due volte, e la prima volta è la prossima
persona che non sa quale dei due è quello vero. L'unico endpoint nuovo è
`POST /studio/products`, perché aggiungere UNA offerta non esisteva da nessuna parte — nemmeno
nella UI, dove `studioActions` sa solo `updateProduct` e `deleteProduct`. La POST su `/products`
non è la stessa cosa: risincronizza il catalogo intero da Shopify o WooCommerce e prima cancella
tutto, quindi una riga scritta a mano non sopravvivrebbe.

Sulla "bio pubblica": l'unica bio che esiste nel prodotto è `social_accounts.bio_url`, il link in
bio (migration 0151). Il piano la descrive come *"the outward brand description"*, ma la
descrizione del brand è `brand_kit.about` ed è già raggiungibile da `update_brand_kit`. La riga è
stata chiusa esponendo l'endpoint che porta quel nome; se l'intenzione era un'altra, la riga va
riscritta nel piano, non implementata a indovinare.

## Il difetto trovato strada facendo

I tre endpoint di modifica rispondevano `{"ok": true}` anche quando la `update` non toccava
nessuna riga. Con `.eq('brand_id', …)` questo succede in due casi: l'id non esiste, oppure è di un
altro brand. Un agente riceveva un successo e credeva di aver corretto un prezzo che nessuno ha
mai cambiato — il modo più silenzioso di non fare il lavoro.

La regola ora sta in un posto solo, `src/lib/server/brand-rows.ts`: `updateBrandRow` e
`deleteBrandRow` chiedono `.select('id')` e leggono le righe toccate. Zero righe → `not_found`
404, **identico** nei due casi, così il 404 non diventa un oracolo che rivela se quell'id esiste
da qualche altra parte. Nello stesso posto sta anche "un patch vuoto non è una scrittura" →
`no_fields` 400. Quattro chiamanti, una regola, una riga di test che la tiene.

## Il registry e il segmento `:id`

`BRAND_ENDPOINTS` copriva solo `/<path>` senza segmenti dinamici, e un test lo imponeva. La
ragione scritta lì era la risoluzione del prefisso (`resolvePostId`): un id di post si scrive
abbreviato e va risolto prima che il path esista. Quella ragione vale per i post e basta — l'id di
un prodotto, di una persona o di un competitor torna per intero da `get_studio` o
`list_products`, e non c'è niente da risolvere.

Due strade erano possibili: portare l'id nel body (semplice, ma avrebbe richiesto un secondo
endpoint per quattro capacità che ne hanno già uno) o insegnare al registry a sostituire `:id`. È
stata scelta la seconda, perché è l'unica che non duplica niente. `pathFor` prende un terzo
argomento opzionale, `callEndpoint` sposta l'id dal body al path, e i metodi ammessi diventano
anche `PUT` e `DELETE`.

Il test guardiano non è stato indebolito: al posto di *"nessun endpoint può avere `:id`"* ora ci
sono tre asserzioni più strette — un endpoint che indirizza una riga deve dichiarare `id` nel
proprio input, nessun altro segmento dinamico è ammesso, e un id mancante fa **eccezione** invece
di chiamare la collezione intera (che per `/products` è la risincronizzazione e-commerce: un
`DELETE` mal costruito lì sarebbe stato un incidente).

Un branch parallelo, `feat/registry-id-endpoints`, ha scritto lo stesso meccanismo in un altro
modo: un campo `resource` con una tassonomia (`post`, `article`) e una tabella di resolver lato
client. Non è pushato e non ha una PR. Quella forma serve ai post, che hanno davvero un prefisso
da risolvere; qui non serve — l'id torna per intero — e i suoi metodi ammessi restano
`GET | POST`, quindi non può esprimere nessuna delle scritture di questa PR. Le due parti si
compongono: la tassonomia e il rifiuto a compile-time di un `pathFor` senza id vanno sopra a
questo, quando i tool dei post entreranno nel registry.

## Il consenso

`PUT /people/:id` accettava quattro campi in whitelist, quindi non poteva già toccare `consent`.
Ora il contratto è `.strict()`: una richiesta che *nomina* `consent`, `consent_source`, `kind` o
`images` viene rifiutata con 400 invece di essere ripulita in silenzio — la differenza conta,
perché un agente che prova a concedere un consenso deve vedere un errore, non un successo
parziale. Il test `non lascia che una modifica attesti il consenso o cambi il tipo di persona`
sta accanto alla rotta, e `people/server.consent.test.ts` continua a coprire la creazione.

## Cosa è stato tolto

`cli/lib/api.ts` aveva già `updateProduct`, `deleteProduct`, `updatePerson` e `updateCompetitor`:
metodi scritti a mano che **nessun comando chiamava**. Ora quelle chiamate le genera il registry,
e i metodi morti sono spariti.
