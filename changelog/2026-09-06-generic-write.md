# `insert_row` e `update_row`: `query` girato, con i confini che la scrittura richiede in più

`query` legge qualunque tabella coi permessi dell'utente. La coda infinita delle scritture aveva lo
stesso problema e nessuna risposta: una riga in una tabella senza tool restava irraggiungibile, e la
lista dei tool cresceva di un `add_*` alla volta.

## Perché due tool e non uno

Un solo `write(op: 'insert' | 'update')` è la forma ovvia, e non può dire la verità. `destructiveHint`
è un'annotazione **per tool** (`cli/mcp/tools/brand-content.ts`, `destructiveHint: endpoint.destructive`)
e il protocollo non sa esprimere «distruttivo solo quando `op = update`». Restano due scelte, e
mentono entrambe: marcato distruttivo avvisa anche sugli insert — che non tolgono niente a nessuno —
e la gente impara a cliccare via l'avviso; marcato non distruttivo tace proprio sugli update, che
sostituiscono valori che c'erano. È l'argomento di `docs/mcp-tools.md` §3, misurato su `ads_action`,
e non dipende da come è scritta una descrizione.

Due tool riportano l'annotazione a dire il vero su entrambi (`insert_row` false, `update_row` true) e
rimettono il verbo nel **nome**, che è da dove un modello sceglie prima di leggere qualunque schema.

## I confini, e perché sono più stretti della lettura

- **Niente delete, niente SQL, niente `.rpc()`.** Come per `query` non è un controllo: è che la forma
  non esiste. Un test legge il sorgente e verifica che il modulo non nomini `.delete(`, `.rpc(`,
  `.upsert(`. Le tredici cancellazioni restano tool espliciti dove si vedono.
- **Niente upsert, ed è una decisione, non una dimenticanza.** `LESSONS.md` racconta le due facce di
  un `onConflict` sbagliato: o non scrive niente (42P10 che supabase-js *risolve* invece di rigettare
  — `competitors` riportava successo scrivendo zero righe), o **sovrascrive** una riga che c'era,
  quando la coppia unica vera è diversa da quella che hai in testa. La prima faccia si chiude
  verificando la chiave contro `pg_indexes`. La seconda no: la chiave può essere reale e non essere
  quella che intendevi, e allora l'insert diventa una sostituzione — cioè esattamente ciò che
  `destructiveHint: false` su `insert_row` giurerebbe di non fare. Il giro in più (23505 che nomina
  il vincolo, poi `update_row` su quelle colonne) rende la sostituzione **scelta** invece che
  scoperta.
- **Il brand si impone, e uno sbagliato è un rifiuto.** `query` aggiunge il filtro quando manca. Qui
  un `brand_id` diverso da quello della conversazione **non viene corretto**: correggerlo direbbe
  «fatto» a chi credeva di scrivere altrove, ed è un errore che si scopre solo rileggendo la tabella.
- **`where` obbligatorio e tetto a 50 righe, contate PRIMA di scrivere.** Un update senza filtro è la
  cancellazione appena vietata, travestita. PostgREST non sa mettere un `LIMIT` su un update, quindi
  il tetto o vive nel conteggio o non esiste. Il conteggio è anche l'unico modo di distinguere «zero
  righe» da «scritto»: un update che non trova niente risponde 200 con l'array vuoto.

## Gli errori: il registro generato dalle migrazioni

Uno SQLSTATE nudo è un giro sprecato. `packages/api-contracts/src/write-rules.ts` è generato dallo
stesso script che genera l'elenco delle tabelle, e porta due cose che l'errore non dice:

- **`TABLE_CHECKS`** — 81 vincoli con la loro espressione, quindi un 23514 risponde
  `Constraint products_url_check allows only: url ~ '^https?://'` invece del nome secco.
- **`WRITABLE_COLUMNS`** — i grant per colonna su `profiles`, `organizations`, `brands`, quindi un
  42501 da grant elenca cosa si può scrivere davvero. E il 42501 **da RLS** ha un messaggio diverso:
  sono due cause che si scrivono uguali e si riparano al contrario, e sceglierne una a caso manda il
  modello a riprovare dove non c'è niente da riprovare.

`scripts/privilege-harness.mjs` tiene il registro onesto contro il **catalogo vero**: ogni nome di
vincolo deve esistere in `pg_constraint`, e le colonne dichiarate devono essere esattamente quelle di
`information_schema.column_privileges`. Un registro generato dalle migrazioni e mai confrontato col
database è una speranza scritta in TypeScript.

## La semantica dell'update parziale, provata invece che data per buona

`update_brand_kit` mandava tutte le colonne con `?? null`, quindi `{category: "bakery"}` scriveva
NULL sopra ciò che il brand dice di sé, del suo pubblico e del suo stile — con `ok: true` e nessuno
schermo. Un update PostgREST parziale tocca solo le colonne inviate, e questo lavoro **non lo
assume**: l'harness scrive una riga di `brand_kit` con quattro campi, ne cambia uno da
`authenticated`, e rilegge gli altri tre.

## Due difetti che solo il browser ha trovato

La suite era verde su entrambi, e su entrambi era verde perché il client finto rispondeva quello che
gli avevo detto io.

1. **PostgREST non risponde 42703 a una colonna inesistente in scrittura: risponde `PGRST204`.** Il
   ripiego «questa tabella non ha `brand_id`, riprova senza» conosceva solo il primo codice, quindi
   ogni insert su una tabella senza `brand_id` moriva dicendo che `brand_id` non esiste — vero e
   inutile. La regola ora vive in un posto solo (`missesBrandColumn`).
2. **`head: true` sul conteggio si porta via il corpo dell'errore.** Senza corpo supabase-js
   consegna `{ message: '', code: undefined }`, e ogni update su una tabella senza `brand_id`
   rispondeva `{"error":"db_error","message":""}`. Un rifiuto che non si riconosce è peggio di uno
   SQLSTATE nudo. Il conteggio ora chiede una riga: è il prezzo del messaggio.

## Il peso

Misurato sul transport (`tools/list` dopo `initialize`), non sui sorgenti:

| | caratteri | tool |
|---|---|---|
| `dev` | 109.837 | 119 |
| con `insert_row` e `update_row` | 112.789 | 121 |

**+2.952.** I due tool non si portano dietro l'enum delle 149 tabelle che `query` ha: là costa ~2.700
caratteri e li vale, perché una lettura si scopre indovinando un nome, mentre chi sta per scrivere ha
appena letto — e la descrizione rimanda a `query` per l'elenco. Il rientro è il censimento qui sotto.

## Il censimento dei 71 handler di scrittura

Aperti tutti. La domanda per ognuno: **cosa fa l'handler oltre a scrivere la riga?**

**Quattro sono `insert`/`update` di una riga e nient'altro — 3.794 caratteri:**

| tool | l'handler, per intero |
|---|---|
| `create_product` | `insert({ brand_id, ...input })` |
| `update_product` | `updateBrandRow` → `.update(patch).eq('id').eq('brand_id')` |
| `update_person` | idem |
| `update_competitor` | idem, più il prefisso `https://` sul sito — che è **già** un CHECK (`competitors_website_check: website ~ '^https?://'`), quindi la regola non sparisce: smette di essere indovinata. `example.com` oggi diventa in silenzio un URL che nessuno ha scritto; con `update_row` viene rifiutato con il vincolo e il suo pattern |

Toglierli è una decisione separata, e questa PR non li toglie: quando atterra, `tools/list` scende
sotto il numero di partenza.

**Quelli che sembrano CRUD e non lo sono — il motivo, per ognuno:**

| tool | cosa si perderebbe |
|---|---|
| `add_competitor` | scrive `source: 'user'`. Il default della colonna è `'ai'`: una riga generica registrerebbe come «trovato dall'AI» un concorrente aggiunto da una persona, e non se ne accorge nessuno |
| `set_colors` | mette il `#` mancante e valida l'esadecimale. `brand_kit_json_shape` controlla solo che sia un array |
| `add_blog_term` | deriva lo `slug` (slugify con strip degli accenti) e sceglie fra tre tabelle |
| `save_brief` | trova il piano `status='active'`, poi rimpiazza `weeks[i]` dentro l'array intero |
| `add_note`, `delete_document` | `rebuildBrandContext` — sintesi col modello |
| `add_person` | le colonne del consenso derivate; con `kind: 'ai'` genera prima le immagini |
| `update_brand_kit` | seconda tabella (`brands.content_prefs`) più il rebuild del contesto |
| `update_voice`, `set_blog_settings`, `set_brand_settings`, `set_media_model`, `set_radar_platform` | **leggono-fondono-riscrivono una colonna jsonb**. Un `update_row` su `content_prefs` cancellerebbe quello che le altre feature ci hanno messo dentro |
| `set_appearance` | scarica il logo con la guardia SSRF e lo mette nello storage |
| `set_bio` | risolve la riga da `(brand, platform)`: l'id non ce l'ha chi chiama |
| `save_memory` | `detectConflict` può **rifiutare** una scrittura che contraddice un fatto messo da una persona; rinforza invece di duplicare |
| `record_memory_used` | è una `rpc` che incrementa in modo atomico: leggere-sommare-riscrivere perde colpi |
| `create_share` | lo `snapshot` È la feature, e il token si conia e non si salva mai in chiaro |
| `add_radar_source` | tetto per piano sul numero di sorgenti, che nessun vincolo del database porta |
| `set_automation` | `enabled: true` **cancella** la riga, `false` la scrive |
| `create_post`, `edit_post`, `reschedule_post`, `reorder_slides`, `render_post` | slot dal fuso del brand, `content_type` dedotto, revisioni, apprendimento della voce dal diff, e il giro su Zernio |
| `import_media_url` | fetch con guardia SSRF e upload: la riga è la ricevuta |
| `save_plan` | prima retrocede il piano `proposed` esistente, poi inserisce |
| `save_week_seeds` | conia gli id dei seed e normalizza i formati |
| `update_article` | transizione di stato derivata da `scheduled_for`, e la seconda tabella dei tag |
| tutti i `generate_*`, `*_action`, `publish_*`, `optimize_*`, `refine_media`, `produce_week` | `gateAiAction`, il modello, o un servizio esterno |
| `create_checkout_link`, `create_billing_portal_link` | Stripe |

`discard_plan` e `unpublish_article` **sono** update secchi, ma sono marcati distruttivi e restano
per la stessa ragione delle cancellazioni: un verbo che disfa qualcosa tiene il proprio nome, dove
si vede.
