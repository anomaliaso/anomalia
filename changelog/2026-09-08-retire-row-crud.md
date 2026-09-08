# I quattro CRUD di una riga escono: `insert_row` e `update_row` li facevano già

`insert_row` e `update_row` sono atterrati con #392 costruiti proprio per assorbirli, e il
censimento di quella PR — aperti tutti i 71 handler del registro — aveva isolato i soli quattro che
sono un `insert` o un `update` di UNA riga e nient'altro: `create_product`, `update_product`,
`update_person`, `update_competitor`. La rimozione era rimasta una decisione, non un verdetto.

## Riletti gli handler, perché il censimento non è una prova

Quattro handler, riaperti uno per uno prima di cancellare. Il rischio da cercare aveva già una
forma nota: `add_competitor` scrive `source: 'user'` mentre la colonna ha default `'ai'`, quindi un
concorrente aggiunto da una persona verrebbe registrato come trovato dall'AI. È il tipo di
attribuzione che un writer generico perde **in silenzio**, ed è la differenza fra un tool che vale
il suo posto e uno che è un giro di parole intorno a un `update`.

| tool | handler | cosa fa oltre a scrivere la riga |
|---|---|---|
| `create_product` | `studio/products/+server.ts` | `insert({ brand_id, ...parsed.data })`. Niente |
| `update_product` | `products/[id]/+server.ts` | `updateBrandRow`. Niente |
| `update_person` | `people/[id]/+server.ts` | `updateBrandRow`. Niente |
| `update_competitor` | `studio/competitors/[id]/+server.ts` | **`normalizeWebsite`** su `website` |

Nessun campo derivato, nessuna attribuzione, nessun effetto collaterale. Le tre risposte
`{ ok: true }` e la quarta `{ ok: true, product: {...} }` sono un sottoinsieme di ciò che
`insert_row` restituisce, che è la riga intera.

## L'unica differenza di comportamento, detta invece che scoperta

`update_competitor` normalizzava `example.com` in `https://example.com`. Quella regola oggi vive nel
database — `competitors_website_check`, `website ~ '^https?://'`, verificato **in produzione** e
`convalidated` — quindi il sito nudo ora è **rifiutato** dove prima era corretto in silenzio.

Il vincolo che rifiuta è meglio della correzione muta: il tool aggiustava `example.com` in un
indirizzo che nessuno aveva scritto, e chi chiamava riceveva `ok` su un dato che non aveva mandato.
Ma il chiamante riceve un errore dove prima riceveva un successo, e questo non si lascia scoprire:
sta nella skill, in tutte e due le superfici, accanto a `products_url_check` che ha la stessa forma
e che `create_product` **non** normalizzava — quindi lì non cambia niente.

La risposta del rifiuto non è uno SQLSTATE nudo: `explainWriteError` nomina il vincolo e i valori
che ammette, che è il motivo per cui quel codice esiste.

## Cosa la rimozione NON copre, e non copriva prima

Lo schema di `update_person` elencava quattro colonne — `name`, `role`, `description`,
`attributes` — e un test asseriva che «non offre nessun campo con cui attestare un consenso».
`update_row` quel restringimento non lo riproduce: la RLS su `people` è una policy `ALL` sul brand
e non ci sono grant per colonna, quindi `consent`, `consent_at` e `consent_source` sono scrivibili.

**Il buco non lo apre questa rimozione: è aperto da #392**, e tenere `update_person` non lo
chiuderebbe, perché `update_row` resta comunque. Qui la skill lo dice come regola — *consent for a
real person is the operator's act, not yours* — e la chiusura vera vuole un grant per colonna o un
trigger, cioè una decisione sul modello dei permessi, non una frase in un prompt.

## Le rotte restano, e si dichiarano

`people/[id]` e `studio/products` non hanno più un contratto che le rivendichi e finiscono in
`REST_ONLY` dentro `registry.test.ts`, che è dove una rotta senza tool si dichiara a mano perché
qualcuno legga la riga e si chieda cosa sia adesso. Le altre due cartelle non ci finiscono: le
rivendica ancora la cancellazione che ci abita accanto.

## Il conto, misurato sul transport

Da **84 tool / 91.158 caratteri** a **80 / 87.360**: −4 tool, −3.798 caratteri, e nessuna capacità
persa. Il tetto in `tool-surface-cost.test.ts` scende da 93.000 a 89.000, e le due soglie di
`tools-coverage.test.ts` da 75 a 71: scendono col numero, o smettono di essere guardie.
