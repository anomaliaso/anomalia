# Il registry sa parlare di un singolo post

`packages/api-contracts` dichiara un endpoint una volta e ne deriva rotta REST,
metodo del client e tool MCP. Copriva 11 endpoint su 71 tool esposti, e il motivo
era uno solo: un test rifiutava qualunque `pathUnderBrand` contenesse `:`.

Il limite era onesto. Un endpoint sotto `/posts/:id` non ha solo un buco nel
path: chi chiama passa `2b38abc5`, non un uuid intero, e qualcuno deve
trasformare il prefisso nell'id prima che la rotta lo veda. Il registry non
sapeva dirlo, quindi quegli endpoint restavano scritti a mano invece di entrare
qui a metà.

## Come è modellato adesso

Un endpoint può dichiarare una **risorsa**. Il path porta un solo buco `:id`, e
il tipo non lascia costruire il path senza l'id: `pathFor` è in overload, quindi
`pathFor(GET_POST, slug)` non compila — non è un controllo a runtime dimenticato
in un ramo, è il compilatore. L'implementazione lancia comunque, per chi arriva
da JavaScript.

**Come si risolve l'id è una proprietà della risorsa, non dell'endpoint.**
`BRAND_RESOURCES` le nomina una volta sola; il client tiene una tabella
`Record<BrandResource, IdResolver>` in `cli/mcp/util.ts`, accanto a
`resolvePostId` e `resolveArticleId`, che è dove la risoluzione può stare —
serve elencare e confrontare, cose che una rotta REST non fa. Una risorsa
aggiunta al registry senza il suo risolutore non compila. Dodici endpoint che
ripetono ciascuno "risolvi come un post" sarebbero stati la condizione sparsa
che questo repo vieta.

La rotta REST non impara niente: continua a ricevere un id già risolto.

Il campo è **opzionale**. Un endpoint che non dichiara una risorsa compila e si
comporta esattamente come prima — le PR aperte che aggiungono righe a
`BRAND_ENDPOINTS` continuano a fare merge senza toccare niente.

## Il test che se ne è andato, e quello che lo sostituisce

`non accetta ancora un endpoint con un segmento :id` era il guardiano del
limite. Al suo posto ce ne sono due più forti: un segmento dinamico esiste **se
e solo se** la risorsa che lo risolve è dichiarata, e nessun altro `:` entra nel
path. Un `:slideIndex` mezzo modellato è ancora rifiutato, e ora lo è anche un
`/posts/:id/...` senza risorsa.

## Cosa è stato migrato

`get_post`, `reschedule_post`, `render_post`: una lettura, una scrittura con
body, una scrittura senza body. Il registry passa da 11 a 14 endpoint, i tool
scritti a mano da 60 a 57 — i tool esposti restano 71.

I test di equivalenza sono stati scritti **prima** della migrazione e messi a
girare sui tool scritti a mano: 13 su 14 passano già lì — nome, schema, campi
obbligatori, annotazioni, il path REST esatto raggiunto dopo la risoluzione del
prefisso, il body inviato, la forma del risultato, e un prefisso ambiguo che non
tocca nessun post. L'unico rosso è quello che pretende la descrizione di `id`
anche su `reschedule_post`, cioè l'unico miglioramento voluto. Dopo la
migrazione passano tutti e 14.

`tools/list` è stato catturato attraverso il transport vero su `origin/dev` e
sul branch, e i due dump confrontati: 71 tool prima e 71 dopo, nessun nome
aggiunto o tolto, e differenze solo nei tre tool migrati.

Tre differenze reali, tutte volute:

- l'input di ogni endpoint del registry è `.strict()`, quindi i tre schemi ora
  dichiarano `additionalProperties: false`. Prima un campo inventato veniva
  scartato in silenzio.
- `id` su `reschedule_post` e `render_post` non aveva descrizione. Ora la
  prende dalla risorsa: "Post id or unambiguous prefix", la stessa che
  `get_post` scriveva a mano.
- `get_post` dichiarava solo `readOnlyHint: true`; adesso porta accanto
  `destructiveHint: false`, che il registry deriva da `destructive`. È la stessa
  coppia che gli altri tool derivati pubblicano già.

Una differenza cosmetica: in `reschedule_post` l'ordine delle proprietà cambia,
perché il loop estende il contratto con `slug` e `id` invece di anteporli.
`properties` è un oggetto e `required` un insieme: nessun client legge l'ordine.
Allinearlo vorrebbe dire cambiarlo per gli undici tool derivati già in produzione.

## Cosa NON è stato migrato, e perché

- **`edit_post`** è una PUT, e il registry conosce solo GET e POST. Aggiungere
  PUT sono tre righe; il problema è un altro: il tool scritto a mano risponde
  `{ ok, id, patch }`, dove `patch` è l'eco dell'input, e la rotta restituisce
  solo `{ ok }`. Derivarlo cambierebbe la forma del risultato, oppure
  costringerebbe il registry a imparare un concetto — "il risultato rimanda
  indietro la richiesta" — che serve a un endpoint solo. Resta scritto a mano.
- **`approve_post`, `publish_post`, `reject_post`** pubblicano davvero, su
  account social veri. Sono derivabili, ma la prova di equivalenza va fatta
  eseguendola, non leggendola, e un approve cambiato di sfumatura è la
  regressione peggiore possibile qui. Restano scritti a mano.
- **`regenerate_post_media`, `regenerate_slide`, `reorder_slides`,
  `make_video`** sono quattro tool sullo stesso path `/posts/:id/media`,
  distinti da un campo `action` costante nel body. Il registry mappa un
  endpoint su un tool: servirebbe un concetto di "campo fissato dal contratto"
  che oggi non serve a nient'altro.

## Un difetto trovato per strada, non corretto qui

`reorder_slides` manda `{ action: 'reorder' }` mentre la rotta
`/posts/[id]/media` conosce solo `restructure`, `regenerate`, `slide` e
`video`: risponde `Unknown action: reorder`, 400. È rotto da prima di questa PR
e la sua correzione è una modifica di comportamento, che non sta in una PR
strutturale.
