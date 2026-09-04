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

Questa parte è stata scritta due volte in parallelo, e la versione che resta non è la mia. Il
branch di questa PR aveva insegnato al registry a sostituire `:id` con `addressesRow` e un terzo
argomento opzionale a `pathFor`; mentre era aperto, la #218 ha portato su `dev` un modello più
forte per la stessa cosa: un campo `resource` con una tassonomia (`BRAND_RESOURCES`), un
`pathUnderBrand` tipizzato come template literal e un `pathFor` **overloaded**, così
`pathFor(GET_POST, slug)` non compila nemmeno — dove la mia versione lanciava a runtime. La mia
implementazione è stata cancellata dal branch, non fusa: due meccanismi per la stessa cosa sono
un debito che si paga a ogni endpoint nuovo.

Quello che il modello della #218 non copriva sono esattamente le scritture di questa PR, e sono
due aggiunte piccole:

- `method` ammetteva solo `GET | POST`. Ora anche `PUT` e `DELETE`, e `callEndpoint` li manda
  (una `DELETE` non porta body).
- `BRAND_RESOURCES` conosceva `post` e `article`. Ora anche `product`, `person` e `competitor`.

I resolver di quei tre non sono identità. `RESOLVE_ID` esisteva già come tabella, ma le due voci
dentro erano due copie della stessa funzione di dodici righe; una terza, quarta e quinta copia
sarebbero state il momento in cui la tabella smette di essere una tabella. Ora c'è un solo
`byPrefix(noun, list)` e cinque righe che lo istanziano — quindi anche un id di prodotto, persona
o competitor accetta un prefisso, che è ciò che la descrizione del tool generato promette già
("id or unambiguous prefix"). Un resolver identità avrebbe reso quella descrizione una bugia.

L'alternativa, portare l'id nel body, è stata scartata: avrebbe richiesto un secondo endpoint di
collezione accanto al `PUT /…/:id` che esiste già, che è esattamente il doppione che questa PR
evita altrove.

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
