# I tool MCP di Anomalia — inventario e piano di aggregazione

**86 tool.** 79 dichiarati nel registro dei contratti, 7 registrati a mano.
9 sono letture. 17 distruggono qualcosa.

**Le letture sono un tool solo, e `query` è quello.** Trentatré `get_*` / `list_*` sono uscite da
`tools/list`; le nove che restano non sono `select`. **Qui è uscito il tool MCP, non l'endpoint:**
le rotte REST ci sono tutte, la CLI le chiama come prima, e le API key le raggiungono come prima.

Contati dal transport vero (`tools/list` dopo `initialize`), non dai sorgenti: prima di questa
misura il documento diceva 127 e nessuno aveva mai visto quel numero.

Questo documento è generato dal registro, non scritto a mano: rigenerarlo è uno script, non un lavoro.

---

## Perché il numero è un problema

Non è estetica. `tools/list` si paga a ogni sessione, ma il costo vero è un altro: **una lista lunga
fa scegliere peggio il modello.** Tre sessioni reali lo hanno dimostrato in un giorno.

| cosa è stato chiesto | cosa è successo |
|---|---|
| *«genera l'immagine di un gatto»* | *«non ho uno strumento di generazione immagini generico»* — `generate_image` era nella lista |
| *«rendi rossa questa foto»* | ne ha **disegnata una nuova** — `refine_media` era nella lista |
| *«animalo con un video di 5s»* | ha rinunciato — `generate_video` era nella lista |

In nessuno dei tre casi mancava la capacità. Mancava il fatto che l'agente la trovasse.

---

## Come fanno gli altri — con i numeri veri

La premessa che «Supabase ne ha 6-7» è sbagliata, e il modo in cui è sbagliata è la cosa
interessante. Contati dai server MCP realmente collegati a questa sessione:

| server | tool | forma |
|---|---|---|
| **PostHog** | **1** | `exec` — un comando solo, la sintassi sta nella descrizione |
| **Stripe** | 10 | di cui **4 sono un proxy generico**: `api_read`, `api_write`, `api_search`, `api_details` |
| **Supabase** | 29 | di cui **1 (`execute_sql`) copre tutte le letture**; le altre 28 sono gestione progetto |
| **Vercel** | 37 | deployment, log, domini, analytics — nessuna primitiva generica |
| **Anomalia** | **86** | |

**Quindi il punto non è che ne hanno pochi: è dove li hanno messi.**

Supabase non espone `get_user_by_email`, `list_orders_last_week`, `count_active_projects`. Espone
`execute_sql`, e la coda infinita delle letture la risolve **il linguaggio che il modello già
conosce**. Stripe fa la stessa cosa un passo più in là: non espone `create_customer` o
`list_charges`, espone «chiama l'API di Stripe».

Vercel invece ne ha 37 e nessuno se ne lamenta, perché sono **azioni** — dispiega, mette in pausa,
compra un dominio. Un'azione non si comprime in un linguaggio: ha un costo e una conseguenza, e chi
la chiama deve vederli prima.

**È esattamente la nostra divisione**, e ora è anche la nostra forma. `query` è una lettura
PostgREST coi permessi di chi chiama — non c'è SQL, quindi una scrittura non ha dove andare — e le
letture che gli convivevano accanto sono scese da 45 a 9.
Estratto dal registro — **79 tool**. Altri 7 sono registrati a mano in `cli/mcp/tools/`: `list_brands`, `approve_post`, `approve_posts`, `reject_post`, `publish_post`, `produce_week`, `generate_person`.

> Il numero si muove: fra la prima stesura di questo documento e la sua revisione, novanta minuti dopo,
> `generate_captions` e `generate_carousel` sono entrati. Per questo l'inventario si rigenera invece
> di mantenersi — e per questo porta il commit da cui è stato estratto.


### `/studio` — 13 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `add_competitor` | POST | `name`, `website`?, `rationale`? |  |
| `add_note` | POST | `text`, `title`? |  |
| `add_person` | POST | `name`, `role`?, `description`?, `consent` |  |
| `create_product` | POST | `title`, `description`?, `pricing`?, `url`?, `kind`?, `featured`? |  |
| `delete_competitor` | DELETE | `id` | ⚠︎ |
| `delete_document` | DELETE | `id` | ⚠︎ |
| `delete_person` | DELETE | `id` | ⚠︎ |
| `research_competitors` | POST | — |  |
| `set_appearance` | PUT | `logo_url`?, `favicon_url`?, `remove_logo`?, `display_font`?, `body_font`?, `graphic_instructions`?, `visual_style`? |  |
| `set_colors` | PUT | `colors` |  |
| `sync_history` | POST | — |  |
| `update_brand_kit` | PUT | `about`?, `category`?, `target_audience`?, `brand_style`?, `language`? |  |
| `update_competitor` | PUT | `id`, `name`?, `website`?, `kind`?, `rationale`? |  |

### `/settings` — 10 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `add_blog_term` | POST | `term`, `name`, `description`?, `bio`?, `role`? |  |
| `add_radar_source` | POST | `kind`, `value`, `lang`? |  |
| `get_media_models` | GET | — |  |
| `remove_blog_term` | POST | `term`, `id` | ⚠︎ |
| `remove_radar_source` | POST | `kind`, `value` | ⚠︎ |
| `set_automation` | PUT | `job`, `enabled` |  |
| `set_blog_settings` | PUT | `enabled`?, `title`?, `description`?, `accent`?, `font`?, `layout`?, `show_blog_link`?, `humanizer_enabled`?, `backlink_network`?, `style_instructions`?, `articles_per_week`?, `default_locale`?, `locales`?, `navbar_links`?, `analytics`? |  |
| `set_brand_settings` | PUT | `timezone`?, `platforms`?, `hashtags`?, `voice_examples`? |  |
| `set_media_model` | PUT | `slot`, `model` |  |
| `set_radar_platform` | PUT | `platform`, `enabled` |  |

### `/web` — 6 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `delete_article` | DELETE | `id` | ⚠︎ |
| `generate_article` | POST | `topic` |  |
| `optimize_article` | POST | — |  |
| `publish_article` | POST | — | ⚠︎ |
| `unpublish_article` | POST | — | ⚠︎ |
| `update_article` | POST | `id`, `title`?, `body_md`?, `meta_title`?, `meta_description`?, `category_id`?, `author_id`?, `tag_ids`?, `language`?, `scheduled_for`? |  |

### `/posts` — 8 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `create_post` | POST | `platforms`, `caption`, `platform_captions`?, `scheduled_for`?, `media_ids`?, `title`?, `subreddit`?, `link_url`? |  |
| `edit_post` | PUT | `caption`?, `title`?, `link_url`?, `subreddit`?, `first_comment`?, `image_prompt`?, `format`?, `slot`?, `product_name`?, `platforms`?, `media_url`?, `platform_captions`? |  |
| `make_video` | POST | `duration`?, `script`?, `instruction`? |  |
| `regenerate_post_media` | POST | `instruction` |  |
| `regenerate_slide` | POST | `index`, `instruction` |  |
| `render_post` | POST | — |  |
| `reorder_slides` | POST | `order` |  |
| `reschedule_post` | POST | `scheduled_for` |  |

### `/editorial-plan` — 7 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `approve_plan` | POST | — | ⚠︎ |
| `discard_plan` | POST | — | ⚠︎ |
| `propose_plan` | POST | — |  |
| `replan_week` | POST | `week`, `brief` |  |
| `revise_plan` | POST | `feedback` |  |
| `save_brief` | POST | `week`, `brief`, `products`? |  |
| `save_plan` | POST | `strategy`, `voice`, `cadence`, `platform_mix`, `gtm`?, `weeks` |  |

### `/media` — 6 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `generate_carousel` | POST | `brief`, `slides`?, `aspect_ratio`?, `model`?, `title`? |  |
| `generate_image` | POST | `prompt`, `count`?, `aspect_ratio`?, `model`?, `title`? |  |
| `generate_media` | POST | `prompt`, `kind`?, `count`?, `aspect_ratio`?, `model`?, `title`? |  |
| `generate_video` | POST | `prompt`, `base_media_id`?, `duration`?, `aspect_ratio`?, `model`?, `title`? |  |
| `import_media_url` | POST | `url`, `title`? |  |
| `refine_media` | POST | `base_media_id`, `instruction`, `count`?, `model`?, `brand_style`?, `title`? |  |

### `/ads` — 3 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `ads_action` | POST | `action`, `campaignId`?, `extra`? | ⚠︎ |
| `ads_remix` | POST | — |  |
| `get_ads` | GET | — |  |

### `/shares` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `create_share` | POST | `view`, `month`?, `expires_in_days`? |  |
| `revoke_share` | POST | `id` | ⚠︎ |

### `/products` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `delete_product` | DELETE | `id` | ⚠︎ |
| `update_product` | PUT | `id`, `title`?, `description`?, `pricing`?, `url`?, `featured`? |  |

### `/memory` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `record_memory_used` | POST | `ids` |  |
| `save_memory` | POST | `key`, `value`, `category` |  |

### `/weekly-plan` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `plan_week` | POST | `week` |  |
| `save_week_seeds` | POST | `week_index`, `theme`, `rationale`?, `do_dont`?, `seeds` |  |

### `/billing` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `create_billing_portal_link` | POST | — |  |
| `create_checkout_link` | POST | `plan`? |  |

### `/geo` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `geo_action` | POST | `action` |  |

### `/bio` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `set_bio` | PUT | `bio_url`, `platform`? |  |

### `/keywords` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `refresh_keywords` | POST | — |  |

### `/knowledge` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `search_knowledge` | GET | `query`, `limit`?, `collection`? |  |

### `/seo` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `seo_action` | POST | `action`, `initiativeId`?, `guidance`? |  |

### `/voice` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `update_voice` | POST | `mood`?, `tone`?, `register`?, `emotion`?, `character`?, `syntax`?, `avoid`?, `platform_instructions`? |  |

### `/social` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `create_social_connect_link` | POST | `platform` |  |

### `/content` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `check_content` | POST | `platforms`, `caption`, `platform_captions`?, `media_ids`?, `title`?, `scheduled_for`? |  |

### `/doctor` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `diagnose_brand` | GET | — |  |

### `/radar` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `diagnose_radar` | GET | — |  |

### `/captions` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `generate_captions` | POST | `topic`, `platforms`?, `format`? |  |

### `/creation-kit` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_creation_kit` | GET | `goal`, `platforms`, `format` |  |

### `/gsc` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_gsc` | GET | — |  |

### `/writing-skills` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_writing_skills` | GET | `agent`?, `reference`? |  |

### `/query` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `query` | POST | `table`?, `columns`?, `where`?, `order`?, `embed`?, `offset`?, `count`?, `limit`? |  |

### `/people` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `update_person` | PUT | `id`, `name`?, `role`?, `description`?, `attributes`? |  |

---

## Piano di aggregazione

### 1. Le letture sono un tool solo, e `query` è quello

Su `tools/list` c'erano **42 letture**. Ora sono **9**, e nessuna è un `select`: trentatré sono
uscite, e a servirle è `query`.

**Perché il tentativo precedente si era fermato a quattro.** Questa sezione diceva che dei 44
handler GET solo 4 erano doppioni, e portava una misura a dimostrarlo — 60 post con didascalie da
539 caratteri, la lunghezza vera:

| lettura | righe che tornano, col tetto a 20.000 caratteri |
|---|---|
| `list_posts`, 17 colonne, nessun tetto | **50 su 50** (63.471 caratteri) |
| `query` con le stesse 17 colonne | **15 su 50** — il tetto morde |
| `query` senza `columns` (`select *`, 54 colonne) | **9 su 50** |

La misura era giusta e la conclusione sbagliata, e la differenza sta in **chi aveva scritto quel
tetto: noi**, in una costante di `query-tool.ts`. Averlo preso per un fatto del mondo è ciò che ha
fermato due tentativi. La conclusione corretta è l'opposta: se `query` non serve bene una lettura,
si sistema `query`.

**Il criterio, adesso, in un posto solo.** Una lettura resta quando la sua risposta **non si
ricostruisce** con `query`: un calcolo su molte tabelle il cui risultato non è nelle righe (un
verdetto, una diagnosi); una lettura che va in rete a prendere qualcosa che nel database non c'è;
un catalogo che vive nel codice e in nessuna tabella. Un `select` con filtri e ordinamento non è
mai quel caso — nemmeno su due tabelle da unire per id, perché `query` sa fare due chiamate e ora
sa anche incorporare la seconda.

#### `query`, per intero

| campo | cosa fa |
|---|---|
| `table` | la tabella da leggere. Omettila e torna l'elenco di quelle che puoi nominare; chiedila senza `columns` e le chiavi di una riga **sono** lo schema |
| `columns` | **nominale sempre.** Senza, tornano tutte le colonne, il tetto sui caratteri butta via righe intere per starci dentro, e una domanda lunga riceve una risposta corta |
| `where` | filtri in AND. Ognuno è `column`, `op`, `value`, più `negate: true` che inverte quel filtro e basta — `is null` diventa `is not null` |
| `order` | un oggetto o un array di oggetti, ognuno con `ascending` e `nullsFirst` |
| `embed` | array di `{table, columns}`: una tabella collegata portata dietro attraverso la sua foreign key, con la RLS applicata anche a quella |
| `offset` | la pagina successiva. La stringa `limits` della risposta nomina l'offset che riprende esattamente dove si era fermata |
| `count` | `"estimated"` (difetto: la stima del planner) oppure `"exact"`, quando **il numero è la risposta** |
| `limit` | 20 per difetto, 200 al massimo |

**I tetti, e nessuno è muto.** La risposta intera si ferma a **60.000 caratteri**. Con `limit: 1`
una riga sola è un documento: il testo lungo torna intero fino a **40.000 caratteri**, che è come
si legge un articolo prima di riscriverlo. Con molte righe i valori lunghi si tagliano a **2.000
caratteri**. **Ogni tetto che morde viene dichiarato in `limits`** — quali colonne ha tagliato, e
da quale offset si riprende. Era questo il difetto peggiore di prima: nove righe su cinquanta,
senza nessun segnale.

Le due riserve che questa sezione portava sono cadute con l'allargamento: `order` prende più di
una colonna, quindi la parità di punteggio di `list_ideas` si esprime; e il tetto sulle righe è
passato da 100 a 200, quindi `get_memory` non perde più le ultime cento.

#### Tolte — 33, e ognuna ha la sua `query`

La skill (`cli/skills/anomalia/SKILL.md`, sezione «Reading is one tool») porta queste query già
scritte, tabella e colonne incluse.

| tool ritirato | come si legge adesso |
|---|---|
| `list_posts` | `query({table:"posts", columns:["id","status","platform","caption","scheduled_for","published_at","created_at"], where:[{column:"status",op:"eq",value:"pending_user"}], order:[{column:"created_at",ascending:false}], limit:50})` |
| `get_post` | la stessa su `posts` con `limit: 1` — una riga sola è un documento, e `media_urls` porta le slide |
| `get_calendar` | `query({table:"posts", columns:["id","platform","caption","scheduled_for","slot","status"], where:[{column:"scheduled_for",op:"is",value:null,negate:true}], order:[{column:"scheduled_for",ascending:true}], limit:100})` |
| `get_status` | `query({table:"posts", columns:["id"], where:[{column:"status",op:"eq",value:"pending_user"}], count:"exact", limit:1})` → `total`, più `brands` per piano e stato |
| `get_dashboard` | gli stessi conteggi con `count: "exact"`, uno per chiamata: dieci letture parallele il cui risultato era un istogramma di stati e sei conteggi |
| `list_media` | `query({table:"brand_media", columns:["id","kind","mime","title","description","tags","short_code","created_at"], order:[{column:"created_at",ascending:false}], limit:100})` — il link da consegnare è `https://anomalia.so/a/<short_code>` |
| `check_media_job` | `query({table:"video_renders", columns:["id","status","error","submitted_at"], order:[{column:"submitted_at",ascending:false}], limit:20})`, poi `brand_media` filtrata `source_ref` su quell'id |
| `get_article` | `query({table:"brand_articles", columns:["id","title","body_md","meta_title","meta_description","status","language"], where:[{column:"id",op:"eq",value:"…"}], embed:[{table:"blog_categories",columns:["name","slug"]},{table:"blog_authors",columns:["name"]}], limit:1})` |
| `get_plan` | `query({table:"editorial_plans", columns:["id","status","strategy","voice","cadence","platform_mix","weeks","created_at","activated_at"], where:[{column:"status",op:"eq",value:"active"}], limit:1})` |
| `get_weekly_plan` | le `weeks` dello stesso piano, più `content_plans` e i `posts` della settimana |
| `get_studio` | `brand_kit`, `products`, `people`, `competitors`, `brand_documents` — una chiamata per tabella |
| `get_voice` | `query({table:"brands", columns:["content_prefs"], where:[{column:"slug",op:"eq",value:"<slug>"}], limit:1})` — mood, tono, registro e regole per piattaforma stanno lì |
| `get_brand_settings` | la stessa riga di `brands`: `timezone`, `target_platforms`, `content_prefs` |
| `get_blog_settings` | `brands.blog_config`, più le tre liste `blog_categories`, `blog_tags`, `blog_authors` |
| `get_radar` | `query({table:"brand_news_sources", columns:["id","kind","value","lang","active"], order:[{column:"created_at",ascending:true}]})`, e `brands.content_prefs.radar` per le piattaforme accese |
| `get_automations` | `query` su `loop_ticks` filtrata su `loop` e `created_at` per cosa hanno fatto, e `brand_job_optouts` per quali sono spenti |
| `get_geo` | `query({table:"brand_geo_audits", columns:["id","created_at","tech_score","tech","share_of_voice","citations"], order:[{column:"created_at",ascending:false}], limit:12})` |
| `list_web_audits` | la stessa lettura su `brand_geo_audits` |
| `get_audit_findings` | la colonna `tech` di quell'audit: è ciò che il crawl ha osservato |
| `list_audit_citations` | la colonna `citations` di quell'audit: engine, domanda posta, verdetto, domini citati |
| `list_web_fixes` | `query({table:"brand_geo_artifacts", columns:["id","kind","title","format","body","status","target_path","source_finding"], where:[{column:"status",op:"eq",value:"draft"}]})` |
| `get_seo` | `brand_seo_plans`, più `brand_geo_audits` e `brand_geo_artifacts` |
| `get_keywords` | `query({table:"brand_seo_keyword_strategy", columns:["strategy","citations","updated_at"], limit:1})` |
| `get_ranks` | `query({table:"brand_tracked_keywords", columns:["id","keyword","locale","device","active"], where:[{column:"active",op:"is",value:true}]})`, poi `brand_rank_snapshots` filtrata `tracked_keyword_id` |
| `get_backlinks` | `brand_backlink_placements` e `brand_backlink_opportunities` |
| `get_knowledge_status` | `query({table:"brand_doc_chunks", columns:["id"], where:[{column:"embedding",op:"is",value:null,negate:true}], count:"exact", limit:1})` → `total` a 0 vuol dire che non c'è ancora niente di cercabile |
| `list_shares` | `query({table:"shared_views", columns:["id","view_type","created_at","expires_at","revoked_at"], order:[{column:"created_at",ascending:false}]})` — nessun token: si mostra una volta sola, alla creazione |
| `list_social_accounts` | `query({table:"social_accounts", columns:["platform","username","display_name","profile_url","status","connected_at","bio_url"]})` |
| `get_bio` | la colonna `bio_url` della stessa lettura |
| `get_analytics` | `posts` per stato e pubblicazioni, più `publish_logs`, `social_post_history` e `social_accounts` |
| `get_gtm` | `gtm_plans`, con `brand_kit` e `products` per il contesto |
| `get_goals` | `chat_goals` e `chat_goal_events` |
| `get_market_field` | `brand_field_posts`, `market_posts`, `market_teardowns`, `brand_market_references` |

**`get_dashboard` è uscito**, e valeva la pena verificarlo invece di darlo per scontato: dieci
letture parallele il cui risultato è un istogramma di stati e sei conteggi, cioè conteggi che
`query` sa fare esatti con `count: "exact"`. `get_status` faceva le stesse due letture cucite
insieme.

#### Restano — 9, ognuna col suo motivo

Stanno in `RESTANO` dentro `cli/mcp/read-tools.test.ts`, con la ragione scritta accanto: il test
fallisce se un decimo tool di lettura compare senza averla.

| tool | perché non è una `query` |
|---|---|
| `list_brands` | senza uno slug `query` non si chiama nemmeno: è da qui che arriva il primo |
| `diagnose_brand` | nove tabelle → un verdetto per cancello, e quale blocca il ciclo |
| `diagnose_radar` | interroga ogni fonte dal vivo: non è nel database |
| `search_knowledge` | due funzioni SQL, un embedding e la fusione dei ranghi; `query` esclude `.rpc()` |
| `get_writing_skills` | due sorgenti su tre sono markdown del repo e costanti di codice |
| `get_creation_kit` | seleziona, pesa e taglia a budget; i template stanno in un file |
| `get_gsc` | somma 28 giorni di righe senza tetto e legge un segreto via rpc |
| `get_ads` | diagnosi di affaticamento su 500 righe di metriche per campagna |
| `get_media_models` | il catalogo dei modelli ammessi sta nel codice, in nessuna tabella |

#### Le rotte REST restano, e i comandi della CLI con loro

**Qui è uscito il tool MCP, non l'endpoint.** `GET /api/v1/brands/:slug/posts`, `/media`,
`/web/article`, `/settings/radar` e tutte le altre rispondono come prima: la CLI le chiama
(`anomalia content`, `anomalia plan`, `anomalia seo`, `anomalia web`, …), le API key di sola
lettura le raggiungono, e `resolveArticleId` continua a risolvere i prefissi degli id passando da
`GET /web`.

Nove letture conservano il proprio schema sotto un nome che dice cosa sono — `LIST_MEDIA_READ`,
`GET_ARTICLE_READ`, … — con `input`, `output` e `failures`, e **senza `tool`**: la rotta continua a
validare e a promettere una forma, ma nessun tool nasce da lì. Le altre sono dichiarate a mano in
`REST_ONLY` dentro `registry.test.ts` — cinquanta voci, di cui ventotto già lì da prima — e quella
lista esiste apposta: una rotta che nessuno può elencare è il modo in cui il percorso a chiave API
diventa in silenzio l'unica strada per un pezzo di prodotto.

**E la chiave API è la ragione per cui quelle rotte non sono ridondanti.** `query` la rifiuta:
pretende un client con la RLS addosso, mentre `authenticate` sul percorso a chiave dà la service
role. Chi legge con una `anomalia_…` legge dagli endpoint, non da `query` — togliere le rotte
insieme ai tool avrebbe tolto a quei clienti la lettura e basta.

### 2. L'autenticazione non era un tool, e uno dei tre mentiva

`login`, `logout`, `whoami` — tolti. Su HTTP l'autenticazione è del **protocollo**: `http-app.ts`
serve `/.well-known/oauth-protected-resource` e risponde 401 con `WWW-Authenticate: Bearer`, che è
il giro che Claude Code, Claude.ai e Cursor fanno da soli.

| tool | perché va via |
|---|---|
| `logout` | **mentiva.** `clearSession()` è `unlinkSync` dentro un `catch {}` sul file di sessione **della macchina che esegue il server**. Da remoto quel file non è del chiamante: l'unlink fallisce, il catch se lo mangia, e il tool rispondeva `{ loggedOut: true }`. Un successo falso a ogni chiamata remota è peggio di un tool assente. |
| `login` | su HTTP era **già morto**: rifiutava con `VERCEL === '1'` o `MCP_REQUIRE_BEARER === '1'`, dicendo di passare un Bearer. |
| `whoami` | funzionava su entrambi i transport, ed è il meno ovvio dei tre. Va via perché la domanda ha già risposta dove serve: su HTTP l'account l'ha scelto l'host, su stdio la sessione è quella della CLI, e `list_brands` dice su cosa si può agire. |

**Il costo, che va detto e non nascosto:** su **stdio** `login` faceva un vero login da browser. Chi
usa l'MCP locale senza aver mai toccato la CLI perde il modo di autenticarsi dall'interno. La
risposta è **`anomalia login` da terminale, una volta**: MCP stdio e CLI escono dallo stesso
pacchetto e condividono lo stesso `session.json`. È un passo in più per qualcuno, non una strada
chiusa.

### 3. Le scritture: il piano di aggregazione è ritirato

Questa sezione proponeva di collassare il CRUD in sei `*_action` e le impostazioni in due o tre.
**Aperti i 72 handler di scrittura, nessuna famiglia supera la prova.** Il piano non viene
rimandato: viene ritirato, e qui sotto c'è il perché, così che chi lo rilegge fra sei mesi trovi la
contraddizione risolta invece che rimossa.

**Il documento si contraddiceva.** Poche righe più sotto, in «La regola che dice cosa NON
raggruppare», enuncia il costo — *«un agente che cerca "aggiungi un concorrente" trova
`add_competitor` all'istante; con `competitor_action(op: 'add')` deve leggere l'enum»* — e tre
righe dopo propone di pagarlo: *«le sei famiglie CRUD diventano `*_action`»*. È la ragione per cui
il piano è stato scritto e mai eseguito.

#### L'eccezione che è stata poi costruita, e che non contraddice quanto segue

Il piano ritirato era «le sei famiglie CRUD diventano `competitor_action(op)`, `person_action(op)`,
…». Quello resta ritirato, e i due argomenti qui sotto restano il perché.

Ciò che è stato costruito è un'altra cosa: **`insert_row` e `update_row`**, la primitiva generica
che sta a `query` come la scrittura sta alla lettura. Non collassa una famiglia dentro un enum —
collassa il *livello*, che è la mossa di Supabase con `execute_sql`. E supera entrambi gli argomenti
invece di aggirarli:

- **`destructiveHint` torna a dire il vero**, perché i tool sono due e non uno. `insert_row` aggiunge
  una riga e non toglie niente (`false`); `update_row` sostituisce valori che c'erano (`true`). Un
  `write(op: 'insert' | 'update')` avrebbe avuto il difetto identico di `ads_action` — ed è
  esattamente per questo che non esiste.
- **Il verbo resta nel nome**, che è da dove un modello sceglie prima di aprire uno schema. Nessuna
  capacità sparisce dentro un enum: c'è un nome per creare e un nome per modificare.

E si ferma dove l'asimmetria comincia: **nessun delete, nessun upsert**. Le tredici cancellazioni
tengono il proprio nome, per la regola in fondo a questo documento; l'upsert è escluso perché un
insert che *può* sostituire rimette dentro esattamente la bugia che i due tool tolgono.

Il censimento che l'ha accompagnato — aperti tutti i 71 handler del registro — conferma i verdetti
qui sotto e ne aggiunge quattro: `create_product`, `update_product`, `update_person`,
`update_competitor` sono un `insert`/`update` di una riga e nient'altro. Sono i soli quattro su 71,
e valgono 3.794 caratteri contro i 3.052 che i due tool aggiungono a `tools/list`. Il motivo per
ognuno degli altri sta in `changelog/2026-09-06-generic-write.md`.

#### Primo argomento: collassare distrugge `destructiveHint`, e questo non è opinabile

L'annotazione è **per tool** — `destructiveHint: endpoint.destructive` in
`cli/mcp/tools/brand-content.ts` — e il protocollo non ha modo di dire «distruttivo solo quando
`action = delete`». Quindi un `*_action` che mette un verbo che distrugge accanto a otto che non
distruggono si marca distruttivo **per intero**.

Non è teoria: è `ads_action` oggi. Un client che avvisa sui tool distruttivi avvisa anche su `sync`
e su `propose`, che non toccano niente. Da lì la gente impara a cliccare via l'avviso, ed è così
che si perde un presidio senza che nessuno lo cancelli.

Questo argomento vale per **ogni** `*_action` proposto, non dipende da come è scritta una
descrizione, e non si può discutere: viene dal protocollo e dal nostro codice.

#### Secondo argomento: un modello legge l'enum DOPO aver scelto il tool

Un modello sceglie dal **nome**. Il valore di un parametro lo legge solo dopo aver aperto il tool,
cioè dopo aver già deciso. Un `action` non lo guida: lo mette davanti a una scelta già fatta. È la
stessa meccanica misurata su `generate_media` in fondo a questo documento — tre sessioni reali in
un giorno, capacità presente, nome non trovato.

Dove i fratelli condividono già il prefisso nel nome (`set_*`), collassare non toglie un enum:
toglie **i nomi**, che sono l'unica cosa che oggi funziona.

#### Il verdetto, famiglia per famiglia

| famiglia | tool | collassare? |
|---|---|---|
| Piano editoriale | `propose_plan` `revise_plan` `save_plan` `approve_plan` `discard_plan` | **peggio, due volte.** `approve_plan` sostituisce il piano attivo, `discard_plan` butta la proposta e «non torna indietro»: due distruzioni permanenti **diverse** dietro un enum |
| Settimana | `plan_week` `replan_week` `save_week_seeds` `save_brief` | peggio. Due spendono crediti e due no — il segnale di costo vive nel nome |
| Post, contenuto | `create_post` `edit_post` `reschedule_post` `render_post` | peggio. Fondere `reschedule_post` in `edit_post` non costa un enum (è un campo in più) ma cancella un nome buono |
| Post, ciclo di vita | `approve_post` `approve_posts` `reject_post` `publish_post` | peggio. `approve_post(all: true)` è un booleano il cui valore sbagliato pubblica tutta la coda |
| Articoli | `generate_article` `update_article` `optimize_article` `publish_article` `unpublish_article` `delete_article` | peggio. Tre verbi permanenti; sono i nomi migliori del repo |
| Studio CRUD | 11 tool fra competitor, person, product, document | peggio — ed è qui che il documento si contraddiceva |
| Identità del brand | `update_brand_kit` `update_voice` `set_colors` `set_appearance` | peggio. Una trappola vera c'è, ma si ripara con una descrizione |
| Impostazioni | 6 × `set_*` | peggio. I nomi **sono già** il discriminante, e sono buoni |
| blog_term · radar_source · share | coppie add/remove | peggio. Ogni coppia è una creazione più una distruzione |
| seo · geo · ads | i tre `*_action` che esistono già | qui sta la misura che manca — sotto |

#### Cosa si fa invece: descrizioni, e una tipizzazione

Tre interventi, tutti piccoli, tutti fatti nello stesso lavoro che ha ritirato questo piano.

1. **`ads_action`: `action` era `z.string().min(1)`** mentre lo `switch` della rotta accetta dieci
   verbi e risponde `unknown_action` a tutto il resto. Una stringa libera davanti a un elenco
   chiuso fa scoprire l'elenco sbagliando, e uno dei dieci **cancella una campagna vera**. Ora è un
   `enum`. La descrizione ne elencava nove e ometteva `approve`, che è quello che **lancia**, cioè
   quello che spende i soldi del brand: ora li nomina tutti e dieci e dice quale spende.
   **Non è stato né collassato né spezzato** — spezzarlo è un cambiamento rotto, e non è oggi.
2. **`set_appearance` non aveva un campo colore** e nemmeno un rimando: chi cerca «cambia i colori
   del brand» apre il tool che si chiama «appearance» e non trova niente. Adesso la descrizione
   dice che la palette è `set_colors`.
3. **`edit_post` ha due parole per «quando»**: prende `slot` (il giorno di calendario) e non
   `scheduled_for` (l'istante in cui il post esce), che cambia solo con `reschedule_post`. Senza il
   rimando un agente sposta il giorno credendo di aver spostato l'ora. È la stessa forma del
   difetto del refine che rigenerava da zero: la capacità c'è, il nome non porta lì.

#### La misura che deciderebbe davvero, e perché oggi non si può fare

I tre `*_action` che esistono già — `seo_action`, `geo_action`, `ads_action` — sono l'esperimento
naturale: se l'enum non danneggiasse la scelta, si vedrebbe qui. La domanda è **quante chiamate
arrivano a un `*_action` con un `action` valido al primo colpo, contro quante arrivano a un tool
con un nome proprio**, e quante tornano `unknown_action`.

**Oggi la risposta è: non si può misurare, e il numero è zero.** `ai_calls` registra la chiamata al
modello, non il tool MCP che l'ha originata, e le sue `label` (`seoAgent`, `ads_campaign_draft`)
sono condivise fra superfici diverse. `mcp_logs` ha la colonna giusta — `tool_name`, scritta da
`cli/mcp/observability.ts` — ma **nessun chiamante la valorizza**: in tutto `cli/mcp/` non c'è un
solo punto che passi `toolName`, quindi la colonna è sempre `null`.

Quindi il prerequisito è una riga sola: passare `toolName` dove il tool viene eseguito. Fatto
quello, la domanda si risponde così:

```sql
-- quota di chiamate riuscite al primo colpo, per tool, sugli ultimi 30 giorni
select tool_name,
       count(*)                                          as calls,
       count(*) filter (where status_code >= 400)         as refused,
       round(100.0 * count(*) filter (where status_code >= 400) / count(*), 1) as refused_pct
from mcp_logs
where tool_name is not null
  and created_at > now() - interval '30 days'
group by tool_name
order by calls desc;
```

**Cosa distingue un successo da un fallimento.** L'ipotesi da battere è che l'enum non costi
niente. Se i tre `*_action` mostrano una quota di rifiuti **paragonabile** ai tool con nome proprio
(entro qualche punto), l'argomento della trovabilità è più debole di come è scritto qui e il piano
di aggregazione si può riaprire — restando fermo il primo argomento, quello del `destructiveHint`,
che nessuna misura può ribaltare. Se invece i `*_action` rifiutano sensibilmente di più, o se
`unknown_action` compare con regolarità, la conclusione è confermata con un numero invece che con
un ragionamento. Serve traffico: sotto qualche centinaio di chiamate per tool il confronto non dice
niente, e va aspettato invece che forzato.

### Il conto

| | |
|---|---|
| prima di questo lavoro | **126** |
| −4 letture che `query` diceva già | 122 |
| −3 tool di autenticazione (`login`, `logout`, `whoami`) | 119 |
| −33 letture, servite da `query` | **86** |

E finisce lì, salvo `generate_media` — l'unica cancellazione a cui questo documento si impegnava
già, in corso su un altro ramo.

Le due righe che stavano qui — «−9 se il CRUD va da 15 a 6», «−7/8 se le impostazioni vanno da 10 a
2/3» — erano stime scritte prima di aprire gli handler; aperti i 72 handler di scrittura, le
famiglie da collassare sono zero. La stima «−22 letture in `query`» era invece **bassa**, e per la
ragione detta in §1: il tetto che la contraddiceva era nostro.

**Il numero non è il bersaglio.** I sette tolti allora non servivano o mentivano; le trentatré
tolte ora sono la stessa capacità sotto un nome solo — nessuna riga è diventata irraggiungibile,
e `tools/list` è sceso da 109.827 a 91.153 caratteri. Gli 86 che restano sono capacità, e una
capacità nascosta in un enum resta nella lista: cambia solo che nessuno la trova.

Non arriveremo mai a 1 come PostHog, e non dobbiamo: **metà del nostro prodotto sono azioni che
costano soldi o pubblicano qualcosa.** Un `execute_action("publish", …)` sarebbe peggio, non meglio.

---

## La regola che dice cosa NON raggruppare

Raggruppare peggiora la scopribilità, che è il difetto che questo lavoro deve risolvere. Un agente
che cerca «aggiungi un concorrente» trova `add_competitor` all'istante; con
`competitor_action(op: 'add')` deve leggere l'enum.

> **Si raggruppa quando le operazioni condividono il soggetto e differiscono solo nel verbo.
> Si tiene separato quando i verbi hanno conseguenze diverse.**

`add_person` e `update_person` sono la stessa cosa con dati diversi. **`delete_person` distrugge** —
e un tool che cancella non deve nascondersi in un enum accanto a due che non cancellano: è il modo
di farlo chiamare per sbaglio. Vale identico per quello che spende crediti.

**Qui il documento si contraddiceva**, e la contraddizione è risolta in §3 invece che tolta: dopo
aver enunciato quel costo, tre righe più sotto proponeva di pagarlo — *«le sei famiglie CRUD
diventano `*_action` per creare e aggiornare»*. Non lo diventano. La regola qui sopra è giusta e
resta; la proposta che la violava è ritirata.

Resta anche la sua metà buona: **le operazioni distruttive tengono il proprio nome, dove si
vedono.** Non perché sia elegante, ma perché `destructiveHint` è per tool e non per valore di enum
— l'argomento meccanico in cima a §3.

E `ads_action` — l'unico esempio che abbiamo — è **già stato segnalato come mal fatto**: `action` è
una stringa libera invece di un enum, e non dichiara `credits_exhausted` pur avendo un `propose` che
chiama il modello. Il modello da imitare va prima riparato.

---

## Come verificare che il taglio non abbia rotto niente

`cli/skills/findability.test.ts` esiste già: una tabella che mappa **la richiesta arrivata
davvero in chat** → il tool che le deve una risposta → le parole che la descrizione deve contenere.
Gira su descrizioni, skill e istruzioni del server.

**Il piano di aggregazione va eseguito contro quel test.** Se dopo il raggruppamento «aggiungi un
concorrente» non arriva più a destinazione, il guadagno non c'è: abbiamo solo spostato la confusione
da una lista lunga a un enum illeggibile.

---

## Cosa manca ancora, al momento di questa revisione

| | stato |
|---|---|
| `refine_video` | **fatto, ma dentro `refine_media` e non come tool suo.** Il blocco era il tempo: `transformVideo` è sincrono con polling fino a 600s contro un muro di funzione a 300. Ora il poll ha un tetto proprio (280s), quindi il client riceve un `render_failed` invece di una connessione che cade — un soffitto dichiarato, non risolto. Toglierlo vuol dire passare dalla coda `video_renders`, come fa `generate_video`, e restituire un `job_id` |
| `motion_control` da MCP | `videoMotionModel` è pinnabile in `set_media_model` e **nessun tool dell'API lo chiama**: esiste solo come tool di chat (`motion_control_video`). Non è finito in `refine_media` di proposito — prendere il movimento da un video guida e applicarlo a un soggetto in una still non è «correggere questo asset», e infilarcelo renderebbe la descrizione ambigua proprio dove non deve esserlo |
| `upscale_video` | progettato, non scritto. Tool suo e non parametro, perché l'ingrandimento di kie prende il `task_id` del lavoro originale e non tocca la libreria, mentre quello di OpenRouter prende un URL: **non sono la stessa capacità con due trasporti** |
| `upscale_image` | **nessun modello lo fa su OpenRouter** — verificati tutti e 50. Chiedere a un modello di generazione di «rifare l'immagine più grande» è una rigenerazione, non un ingrandimento: torna un'immagine *diversa* a risoluzione maggiore |

I tool per **modificare** un carosello non ci sono di proposito: `generate_carousel` vive sotto
`/media/carousel` e restituisce la sequenza intera — N id di media più i `continuity_tokens` — senza
creare nessun post. Quindi l'array è dell'agente: riordinare è l'ordine degli argomenti a
`create_post`, togliere è ometterne uno, cambiare una slide è `refine_media` sul suo id, aggiungerne
una è `generate_image` con quei gettoni nell'istruzione.

`regenerate_slide` e `reorder_slides` sono i vecchi, e restano perché **un post possiede le sue
slide**: lì l'agente non può toccarle direttamente. Senza post quel vincolo non c'è.

---

## Unificare i generatori in un tool solo: si può, ma il conto non torna

La proposta: un `generate_media` con un `kind`, più un `get_generate_media_params` che dica quali
parametri servono per ciascun tipo, e una convalida su quello che arriva.

**La seconda metà non serve, ed è la parte interessante.** `tools/list` **porta già lo schema JSON
completo di ogni tool** — è il protocollo a farlo, e ogni client lo riceve prima di chiamare
qualunque cosa. Un tool che descrive i parametri di un altro tool riscrive, peggio e a pagamento,
qualcosa che arriva gratis.

E se i parametri cambiano per tipo, zod lo esprime **dentro un unico schema** con una unione
discriminata: `kind: 'image'` chiede una cosa, `kind: 'video'` un'altra, e il client vede entrambe
le forme senza un secondo giro. **La convalida viene dalla stessa unione**, quindi arriva gratis
anche quella.

**La prima metà si può fare e secondo me non conviene**, per la ragione che questo documento apre:
tre agenti in un giorno si sono arresi davanti a una capacità presente perché **non ne hanno trovato
il nome**. `generate_media(kind: 'refine')` è meno trovabile di `refine_image`, non più. Il costo si
sposta dalla lunghezza della lista alla leggibilità di un enum, e l'enum è il posto peggiore in cui
metterlo, perché un modello lo legge dopo aver già deciso quale tool aprire.

Un caso però è netto: **`generate_media` oggi è un doppione.** La sua stessa descrizione dice
*«PREFER `generate_image` or `generate_video` … this one stays and keeps working, forwarding to
those two»*. Non aggiunge nessuna capacità, e mette due nomi davanti a chi cerca «genera
un'immagine». Nessun cliente lo chiama — la superficie MCP remota ha ripreso a dispiegarsi solo
oggi. **Quello si toglie**, e porta 127 a 126 togliendo un'ambiguità invece di una capacità.

---

## I quattro tool specifici, misurati contro `generate_media`

La richiesta era: «metti `generate_media` e `refine_media` al posto degli altri». Prima di
cancellare una riga, il confronto — perché **`generate_media` non copre per intero nemmeno uno dei
quattro**, e il verso dell'aggregazione, guardando il codice, è l'opposto di come è stata posta.

| tool | cosa fa che l'aggregatore non sa fare | esito |
|---|---|---|
| `generate_image` | funziona **senza brand** (`pathWithoutBrand: /images`): torna `id: null`, `storage_path`, `organization` e `cost_usd`. Ha `brand_style: apply\|ignore`. `generate_media` vive solo sotto un brand e la sua stessa descrizione dice che il look del brand «cannot be switched off from this door» | **resta** |
| `refine_image` | `base_media_id` + `instruction`: parte da un asset esistente, con lo slot `imageRefineModel`. In `generate_media` il parametro **non esiste**: non sa rifinire | **diventa `refine_media`** |
| `generate_video` | `base_media_id` (anima una foto) e `duration`, con la finestra per modello e `duration_out_of_range` invece di un arrotondamento muto. Restituisce `duration_seconds`, i secondi davvero mandati — e una clip si paga al secondo. `generate_media(kind:'video')` inoltra allo stesso `startVideo` ma **non ha né `base_media_id` né `duration`** | **resta** |
| `generate_carousel` | pianifica la serie una volta (`planCarousel`) e restituisce i `continuity_tokens`, che sono ciò che tiene insieme le slide. `generate_media` non ha `brief`, non ha `slides`, non pianifica nulla: `count: 4` sono quattro immagini scorrelate, e il suo tetto è 4 mentre un carosello arriva a 8 | **resta** |

Il fatto che decide: `generate_media` è **la porta più vecchia**, non l'aggregatore. È del commit
`96dc587e` (17:04), i tool espliciti del `21c530d7` (18:17) un'ora dopo, e sia il contratto sia
`media-generate.ts` dicono in chiaro *«non fa più il lavoro: lo inoltra a generate_image e
generate_video»*. Aggregare verso `generate_media` significherebbe tornare indietro, non avanti —
ed è esattamente ciò che la sezione qui sopra sconsiglia, con tre sessioni vere a dimostrarlo.

**Quello che si è fatto**, quindi, è la sola metà che regge da sola: `refine_image` diventa
`refine_media`. Non è un'aggregazione dentro un enum — il verbo resta nel nome, che è la proprietà
che rendeva `refine_image` trovabile — ed è un allargamento vero: la stessa porta serve ora
un'immagine **e** una clip, e il tipo lo decide la riga di libreria invece di chi chiama.
`videoRefineModel` esisteva in `set_media_model` e nessun tool lo chiamava: era una preferenza che
un brand poteva scegliere e che non faceva niente.

Gli altri tre non si toccano: toglierli toglierebbe capacità, non ambiguità. Il doppione da
togliere resta `generate_media`, come questo documento dice già sopra — ed è una decisione separata,
perché rompe chiunque lo abbia cablato.
