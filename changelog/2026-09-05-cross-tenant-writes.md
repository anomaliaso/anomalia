# Il `WHERE` era scopato, il bersaglio no

Due scritture arrivavano nei dati di un altro cliente. Sono lo stesso difetto due volte, e la
somiglianza è il punto: in entrambe c'è un vincolo di brand scritto bene, e in entrambe non
copre la cosa che viene toccata davvero.

## Uno: i tag di un articolo si cancellavano da un altro cliente

`src/routes/app/[brand]/site/edit/[id]/+page.server.ts`. L'update dell'articolo era scopato
(`.eq('id', …).eq('brand_id', brand.id)`) e sembrava difendere ciò che seguiva. Non difendeva
niente: **un update che non trova righe non è un errore**, quindi `err` era nullo e l'esecuzione
proseguiva fino a `admin.from('brand_article_tags').delete().eq('article_id', params.id)` — client
service role, nessuna RLS, nessun brand. `brand_article_tags` non ha `brand_id`: lo scopo può
passare solo dall'articolo.

Adesso l'update passa da `updateBrandRow`, che c'era già e fa esattamente questo: aggiorna scopato,
`.select('id')`, e restituisce 404 se non ha toccato niente. Le scritture sui tag sono raggiungibili
solo dopo quella prova. Il fallimento silenzioso — 200 `{saved:true}` su un articolo che non è tuo —
è sparito con lo stesso cambiamento.

## Due: una riga di memoria si spostava nel brand di un altro cliente

`src/routes/api/v1/brands/[slug]/studio/memory/[id]/+server.ts`. Il corpo grezzo della richiesta
finiva intero nel `SET` di un update scopato per `brand_id`. Il `WHERE` trovava la riga nel brand
di chi chiamava, il `SET` la riscriveva col `brand_id` di un altro: la riga cambiava proprietario e
da lì in poi alimentava gli agenti della vittima come contesto. Sul percorso a chiave API il client
è service role, quindi il `WITH CHECK` della RLS che avrebbe fermato la cosa sul percorso JWT non
girava mai.

Questa era **l'unica rotta dell'albero** che dava un corpo non analizzato a `.update()`: ogni
sorella (`people/[id]`, `competitors/[id]`, `settings/brand`) passa da un contratto zod `.strict()`.
Adesso ci passa anche lei — `UPDATE_MEMORY_ENTRY` in `packages/api-contracts/src/memory.ts`, cinque
campi e nient'altro. Non è un `BrandEndpoint` e non entra in `BRAND_ENDPOINTS`: non nasce un tool
MCP nuovo, è solo la forma del corpo.

## Le due guardie, e la prova che guardano

`src/no-cross-tenant-writes.test.ts` legge il sorgente di `src/` e fa cadere la build su due forme:

1. una scrittura service role filtrata su un id esterno **senza colonna del tenant nella stessa
   query**, a meno che prima non ci sia una prova che l'id è di questo brand — una lettura scopata
   che finisce in `maybeSingle`/`single`, o `updateBrandRow`/`deleteBrandRow`, che contano le righe
   toccate. **Un update scopato che nessuno conta non vale come prova**, ed è precisamente la
   distinzione che serviva: senza di essa la regola avrebbe accettato il difetto uno.
2. un corpo di richiesta non analizzato che viaggia intero fino a un `SET`.

Sono state provate contro il sorgente prima della correzione: la prima trova la delete dei tag, la
seconda trova la PATCH della memoria, e su questo branch trovano zero. Sono approssimate per
costruzione — riconoscono il client dal nome (`createAdminClient()`, e `supabase` sotto
`src/routes/api/`, dove `authenticate()` restituisce service role) e la prova vale per ciò che segue
nel file. Le sonde a fixture nello stesso file tengono onesta la regola: se smette di riconoscere il
difetto, cade la prima sonda, non il silenzio.

## Il resto dell'albero

La prima regola ha trovato sei altre scritture della stessa forma, tutte già coperte da una lettura
scopata che torna 404 prima di scrivere (`studio/documents/[id]`, `studio/people/[id]`,
`posts/[id]/reschedule`), o dal client con RLS del browser (`settings-actions.ts` su `brands`
filtrato per slug). La seconda non ha trovato nient'altro. La forma è un incidente ripetuto due
volte, non un'abitudine — ma finora niente impediva la terza.
