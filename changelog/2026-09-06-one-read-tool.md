# Le letture sono un tool solo, e `query` è quello

Su `tools/list`, misurato attraverso il transport vero (`handleMcpFetch`), c'erano **119 tool: 42
letture e 77 scritture**. Ora sono **86: 9 letture e le stesse 77 scritture**. Trentatré letture
sono uscite, e a servirle è `query`.

## Perché il tentativo precedente si era fermato

Un'analisi precedente aveva concluso che solo 4 letture su 44 erano doppioni, e la prova era
questa: `list_posts` restituisce 50 righe su 50, la stessa lettura via `query` ne restituisce 15,
perché il tetto di 20.000 caratteri taglia.

Quel tetto era **nostro** — una costante in `query-tool.ts`, scritta da noi. Averlo preso per un
fatto del mondo è ciò che ha bloccato due tentativi. La conclusione corretta è l'opposta: se
`query` non serve bene una lettura, si sistema `query`.

## Il criterio, in un posto solo

Una lettura resta quando la sua risposta **non si ricostruisce** con `query`:

- un calcolo su molte tabelle il cui risultato non è nelle righe (un verdetto, una diagnosi);
- una lettura che va in rete a prendere qualcosa che nel database non c'è;
- un catalogo che vive nel codice e in nessuna tabella.

Un `select` con filtri e ordinamento non è mai quel caso — nemmeno su due tabelle da unire per id,
perché `query` sa fare due chiamate e ora sa anche incorporare la seconda.

Le nove che restano, ognuna col suo motivo, stanno in `RESTANO` dentro `cli/mcp/read-tools.test.ts`:
`list_brands` (senza uno slug `query` non si chiama nemmeno), `diagnose_brand`, `diagnose_radar`,
`search_knowledge`, `get_writing_skills`, `get_creation_kit`, `get_gsc`, `get_ads`,
`get_media_models`.

**`get_dashboard` è uscito**, e valeva la pena verificarlo invece di darlo per scontato: dieci
letture parallele il cui risultato è un istogramma di stati e sei conteggi. Con `count: "exact"`
sono conteggi che `query` sa fare, esatti, uno per chiamata. `get_status` faceva le stesse due
letture cucite insieme.

`get_media_models` invece resta per una ragione precisa: `set_media_model` prende `model` come
stringa libera, e l'elenco dei modelli che ogni mestiere accetta vive in `$lib/media-model-slots`,
che un contratto non può importare. È l'unico posto dove quei valori sono scritti.

## Cosa è stato aggiunto a `query`, e perché ognuna serviva

| capacità | la lettura che la chiedeva |
|---|---|
| `offset` | `list_posts` restituiva 50 righe; quello che non entrava era **irraggiungibile** |
| `count: "exact"` | i conteggi di `get_dashboard` e `get_status`; la stima del planner non è una risposta |
| troncamento che si dichiara | il difetto peggiore: nove righe su cinquanta senza nessun segnale |
| `negate` su un filtro | `get_calendar` filtra `scheduled_for is not null`, e non si sapeva scrivere |
| `order` come lista, con `nullsFirst` | `get_weekly_plan` ordina `slot asc nullsFirst:false` |
| `embed` | `get_article` porta categoria, autore e tag: tre embed PostgREST, RLS applicata a ognuno |
| una riga sola torna intera | `get_article` esisteva per leggere un articolo e **riscriverlo**: un `body_md` tagliato a 2.000 caratteri e riscritto sopra l'originale è la peggiore delle perdite |

`QUERY_MAX_CHARS`: 20.000 → **60.000**. Non scelto, misurato. La risposta di `list_posts` — 50 post
con le loro 17 colonne e caption vere — pesa **45.781 caratteri** contro il database locale. Il
tetto sta sopra quel numero con margine, perché è esattamente il costo che il tool ritirato aveva
già. È un soffitto, non un default: con le colonne nominate una lettura normale ne usa una
frazione, e quando morde lo dice e dà l'offset per riprendere.

`QUERY_MAX_ROWS`: 100 → 200, perché `list_media` ne serviva 200.

**Due cose non sono state toccate**, e sono le migliori del file: il filtro `brand_id` imposto
quando il modello non l'ha messo, e la sonda dello schema sul 42703 con la distinzione fra nome
sbagliato in `columns` (si ritenta con `*`) e in `where`/`order` (non si ritenta, perché togliere
un filtro farebbe tornare righe che nessuno ha chiesto e il tool direbbe «ok»).

## La prova che non è un'opinione

Contro il database locale, con la sessione di un utente vero, la funzione che il tool usava e la
`query` equivalente, a confronto:

```
list_posts → rows                    tool 50 · query 50 (total 60)
list_posts → same ids, same order     first 2c8f5edc
list_posts → captions intact          caption 372 chars · query rows 50
list_posts → page 2 reachable         offset 50 → 10 rows
get_status pendingCount → exact       query total 15 · db 15
get_calendar → same scheduled rows    tool 60 · query 60 (negate on is-null works)
list_media → same rows                tool 4 · query 4
get_studio → products / competitors   tool 0 · query 0
one row is a document                 372 chars whole
```

## Il conto in token, che è la ragione per cui questo non peggiora niente

Misurato sul transport, contro `dev` a `26bcc521` (che aveva già tagliato le ripetizioni nelle
descrizioni, #387):

- `tools/list`: **109.827 → 91.153 caratteri** (−18.674)
- descrizioni delle letture: **12.359 → 3.201**
- descrizione di `query`: **1.230 → 1.736** (+506)
- `MCP_INSTRUCTIONS`: 1.089 → 1.668, e il budget in `findability.test.ts` sale da 1.300 a 1.700
  **con la ragione scritta accanto alla costante** — ora quelle istruzioni sono il percorso
  principale, non un promemoria.

`query` cresce di 506 caratteri e ne porta via 9.158: il conto migliora insieme al conteggio.

## Le rotte REST restano

Qui è uscito il tool MCP, non l'endpoint: la CLI e i clienti dell'API le chiamano ancora — e
`query` la chiave API la RIFIUTA di proposito, quindi per chi legge con una chiave quelle rotte
sono l'unica strada. **Nove** letture conservano il loro schema sotto un nome che dice cosa sono —
`LIST_MEDIA_READ`, `GET_ARTICLE_READ`, … — con `input`, `output` e `failures`, e senza `tool`: la
rotta continua a validare e a promettere una forma, ma nessun tool nasce da lì.

`REST_ONLY` in `registry.test.ts` passa da 31 voci a 50: **diciannove rotte in più** che nessun
contratto descrive più, dichiarate a mano perché è così che quel test è fatto — una rotta che
nessuno può elencare è il modo in cui il percorso a chiave API diventa in silenzio l'unica strada
per un pezzo di prodotto.

## Dove un agente scopre che si fa così

Tre superfici, aggiornate insieme alla rimozione, perché una rimozione senza di loro è una perdita:

1. `MCP_INSTRUCTIONS` — il client le mostra al handshake, prima di ogni descrizione;
2. la descrizione di `query`, dove il chiamante legge nel momento in cui gli serve;
3. la skill in `cli/skills/anomalia/`, col mirror generato, che per post, media, articoli, memoria,
   concorrenti e le altre letture usate porta **la query già scritta**, tabella e colonne incluse.
