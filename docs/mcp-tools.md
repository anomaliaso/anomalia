# I tool MCP di Anomalia — inventario e piano di aggregazione

**127 tool.** 116 dichiarati nel registro dei contratti, 11 registrati a mano.
45 sono letture. 13 distruggono qualcosa.

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
| **Anomalia** | **127** | |

**Quindi il punto non è che ne hanno pochi: è dove li hanno messi.**

Supabase non espone `get_user_by_email`, `list_orders_last_week`, `count_active_projects`. Espone
`execute_sql`, e la coda infinita delle letture la risolve **il linguaggio che il modello già
conosce**. Stripe fa la stessa cosa un passo più in là: non espone `create_customer` o
`list_charges`, espone «chiama l'API di Stripe».

Vercel invece ne ha 37 e nessuno se ne lamenta, perché sono **azioni** — dispiega, mette in pausa,
compra un dominio. Un'azione non si comprime in un linguaggio: ha un costo e una conseguenza, e chi
la chiama deve vederli prima.

**È esattamente la nostra divisione.** Noi abbiamo già `query` — SQL in sola lettura coi permessi
dell'utente. Il problema è che ci convivono 45 tool di lettura.
Estratto da `d099e02a` — **116 tool** nel registro, **247 parametri**. Altri 11 sono registrati a mano in `cli/mcp/tools/`: `login`, `logout`, `whoami`, `list_brands`, `get_status`, `approve_post`, `approve_posts`, `reject_post`, `publish_post`, `produce_week`, `generate_person`.

> Il numero si muove: fra la prima stesura di questo documento e la sua revisione, novanta minuti dopo,
> `generate_captions` e `generate_carousel` sono entrati. Per questo l'inventario si rigenera invece
> di mantenersi — e per questo porta il commit da cui è stato estratto.


### `/studio` — 15 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `add_competitor` | POST | `name`, `website`?, `rationale`? |  |
| `add_note` | POST | `text`, `title`? |  |
| `add_person` | POST | `name`, `role`?, `description`?, `consent` |  |
| `create_product` | POST | `title`, `description`?, `pricing`?, `url`?, `kind`?, `featured`? |  |
| `delete_competitor` | DELETE | `id` | ⚠︎ |
| `delete_document` | DELETE | `id` | ⚠︎ |
| `delete_person` | DELETE | `id` | ⚠︎ |
| `get_appearance` | GET | — |  |
| `get_studio` | GET | `documents`? |  |
| `research_competitors` | POST | — |  |
| `set_appearance` | PUT | `logo_url`?, `favicon_url`?, `remove_logo`?, `display_font`?, `body_font`?, `graphic_instructions`?, `visual_style`? |  |
| `set_colors` | PUT | `colors` |  |
| `sync_history` | POST | — |  |
| `update_brand_kit` | PUT | `about`?, `category`?, `target_audience`?, `brand_style`?, `language`? |  |
| `update_competitor` | PUT | `id`, `name`?, `website`?, `kind`?, `rationale`? |  |

### `/settings` — 14 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `add_blog_term` | POST | `term`, `name`, `description`?, `bio`?, `role`? |  |
| `add_radar_source` | POST | `kind`, `value`, `lang`? |  |
| `get_automations` | GET | — |  |
| `get_blog_settings` | GET | — |  |
| `get_brand_settings` | GET | — |  |
| `get_media_models` | GET | — |  |
| `get_radar` | GET | — |  |
| `remove_blog_term` | POST | `term`, `id` | ⚠︎ |
| `remove_radar_source` | POST | `kind`, `value` | ⚠︎ |
| `set_automation` | PUT | `job`, `enabled` |  |
| `set_blog_settings` | PUT | `enabled`?, `title`?, `description`?, `accent`?, `font`?, `layout`?, `show_blog_link`?, `humanizer_enabled`?, `backlink_network`?, `style_instructions`?, `articles_per_week`?, `default_locale`?, `locales`?, `navbar_links`?, `analytics`? |  |
| `set_brand_settings` | PUT | `timezone`?, `platforms`?, `hashtags`?, `voice_examples`? |  |
| `set_media_model` | PUT | `slot`, `model` |  |
| `set_radar_platform` | PUT | `platform`, `enabled` |  |

### `/web` — 12 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `delete_article` | DELETE | `id` | ⚠︎ |
| `generate_article` | POST | `topic` |  |
| `get_article` | GET | `id` |  |
| `get_audit_findings` | GET | `audit_id`? |  |
| `list_articles` | GET | `status`? |  |
| `list_audit_citations` | GET | `audit_id`?, `limit`?, `offset`? |  |
| `list_web_audits` | GET | `limit`?, `offset`? |  |
| `list_web_fixes` | GET | `fix_id`?, `status`?, `limit`?, `offset`? |  |
| `optimize_article` | POST | — |  |
| `publish_article` | POST | — | ⚠︎ |
| `unpublish_article` | POST | — | ⚠︎ |
| `update_article` | POST | `id`, `title`?, `body_md`?, `meta_title`?, `meta_description`?, `category_id`?, `author_id`?, `tag_ids`?, `language`?, `scheduled_for`? |  |

### `/posts` — 10 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `create_post` | POST | `platforms`, `caption`, `platform_captions`?, `scheduled_for`?, `media_ids`?, `title`?, `subreddit`?, `link_url`? |  |
| `edit_post` | PUT | `caption`?, `title`?, `link_url`?, `subreddit`?, `first_comment`?, `image_prompt`?, `format`?, `slot`?, `product_name`?, `platforms`?, `media_url`?, `platform_captions`? |  |
| `get_post` | GET | — |  |
| `list_posts` | GET | `status`? |  |
| `make_video` | POST | `duration`?, `script`?, `instruction`? |  |
| `regenerate_post_media` | POST | `instruction` |  |
| `regenerate_slide` | POST | `index`, `instruction` |  |
| `render_post` | POST | — |  |
| `reorder_slides` | POST | `order` |  |
| `reschedule_post` | POST | `scheduled_for` |  |

### `/editorial-plan` — 8 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `approve_plan` | POST | — | ⚠︎ |
| `discard_plan` | POST | — | ⚠︎ |
| `get_plan` | GET | — |  |
| `propose_plan` | POST | — |  |
| `replan_week` | POST | `week`, `brief` |  |
| `revise_plan` | POST | `feedback` |  |
| `save_brief` | POST | `week`, `brief`, `products`? |  |
| `save_plan` | POST | `strategy`, `voice`, `cadence`, `platform_mix`, `gtm`?, `weeks` |  |

### `/media` — 8 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `check_media_job` | GET | `job_id`? |  |
| `generate_carousel` | POST | `brief`, `slides`?, `aspect_ratio`?, `model`?, `title`? |  |
| `generate_image` | POST | `prompt`, `count`?, `aspect_ratio`?, `model`?, `title`? |  |
| `generate_media` | POST | `prompt`, `kind`?, `count`?, `aspect_ratio`?, `model`?, `title`? |  |
| `generate_video` | POST | `prompt`, `base_media_id`?, `duration`?, `aspect_ratio`?, `model`?, `title`? |  |
| `import_media_url` | POST | `url`, `title`? |  |
| `list_media` | GET | `query`?, `limit`? |  |
| `refine_media` | POST | `base_media_id`, `instruction`, `count`?, `model`?, `brand_style`?, `title`? |  |

### `/ads` — 3 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `ads_action` | POST | `action`, `campaignId`?, `extra`? | ⚠︎ |
| `ads_remix` | POST | — |  |
| `get_ads` | GET | — |  |

### `/shares` — 3 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `create_share` | POST | `view`, `month`?, `expires_in_days`? |  |
| `list_shares` | GET | — |  |
| `revoke_share` | POST | `id` | ⚠︎ |

### `/products` — 3 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `delete_product` | DELETE | `id` | ⚠︎ |
| `list_products` | GET | — |  |
| `update_product` | PUT | `id`, `title`?, `description`?, `pricing`?, `url`?, `featured`? |  |

### `/memory` — 3 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_memory` | GET | `category`?, `limit`? |  |
| `record_memory_used` | POST | `ids` |  |
| `save_memory` | POST | `key`, `value`, `category` |  |

### `/weekly-plan` — 3 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_weekly_plan` | GET | — |  |
| `plan_week` | POST | `week` |  |
| `save_week_seeds` | POST | `week_index`, `theme`, `rationale`?, `do_dont`?, `seeds` |  |

### `/billing` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `create_billing_portal_link` | POST | — |  |
| `create_checkout_link` | POST | `plan`? |  |

### `/geo` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `geo_action` | POST | `action` |  |
| `get_geo` | GET | — |  |

### `/bio` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_bio` | GET | `platform`? |  |
| `set_bio` | PUT | `bio_url`, `platform`? |  |

### `/keywords` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_keywords` | GET | — |  |
| `refresh_keywords` | POST | — |  |

### `/knowledge` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_knowledge_status` | GET | — |  |
| `search_knowledge` | GET | `query`, `limit`?, `collection`? |  |

### `/seo` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_seo` | GET | — |  |
| `seo_action` | POST | `action`, `initiativeId`?, `guidance`? |  |

### `/voice` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_voice` | GET | — |  |
| `update_voice` | POST | `mood`?, `tone`?, `register`?, `emotion`?, `character`?, `syntax`?, `avoid`?, `platform_instructions`? |  |

### `/social` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `create_social_connect_link` | POST | `platform` |  |
| `list_social_accounts` | GET | — |  |

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

### `/analytics` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_analytics` | GET | — |  |

### `/backlinks` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_backlinks` | GET | — |  |

### `/calendar` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_calendar` | GET | `month`? |  |

### `/creation-kit` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_creation_kit` | GET | `goal`, `platforms`, `format` |  |

### `/root` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_dashboard` | GET | — |  |

### `/goals` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_goals` | GET | `limit`?, `thread`? |  |

### `/gsc` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_gsc` | GET | — |  |

### `/gtm` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_gtm` | GET | — |  |

### `/market` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_market_field` | GET | `limit`? |  |

### `/ranks` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_ranks` | GET | — |  |

### `/writing-skills` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `get_writing_skills` | GET | `agent`?, `reference`? |  |

### `/ideas` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `list_ideas` | GET | `status`?, `limit`? |  |

### `/query` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `query` | POST | `table`?, `columns`?, `where`?, `order`?, `limit`? |  |

### `/people` — 1 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `update_person` | PUT | `id`, `name`?, `role`?, `description`?, `attributes`? |  |

---

## Piano di aggregazione

### 1. Le letture: 22 tool spariscono dentro `query`

Sono una tabella e un filtro, e `query` le fa già oggi:

`list_posts` · `list_products` · `list_articles` · `list_ideas` · `list_shares` · `list_web_audits`
· `list_web_fixes` · `list_audit_citations` · `get_audit_findings` · `get_article` · `get_calendar`
· `get_bio` · `get_voice` · `get_gtm` · `get_plan` · `get_weekly_plan` · `get_keywords` ·
`get_ranks` · `get_goals` · `get_market_field` · `get_memory` · `check_media_job`

**Le altre 23 letture restano, e il motivo cambia per gruppo** — questo è il pezzo che impedisce di
tagliare troppo:

| perché resta | tool |
|---|---|
| **coniano quello che `query` non può** — un URL firmato per lo storage privato; una riga grezza dà un percorso che nessuno apre | `list_media`, `get_post`, `get_appearance` |
| **escono dall'edificio** — chiamano un servizio esterno | `get_gsc`, `diagnose_radar`, `get_ads`, `list_social_accounts` |
| **calcolano** — recupero + embedding, composizioni, diagnosi | `search_knowledge`, `get_dashboard`, `get_analytics`, `diagnose_brand`, `get_seo`, `get_geo`, `get_knowledge_status`, `get_creation_kit` |
| **leggono cose che non sono tabelle** | `get_writing_skills`, `get_media_models` |
| **applicano una regola che la riga nuda non porta** — tetti di piano, vocabolari ammessi | `get_radar`, `get_blog_settings`, `get_brand_settings`, `get_automations` |

### 2. Il CRUD: 15 tool in 6

Sei entità hanno più di un verbo, e il repo **ha già fatto questa mossa tre volte** — `ads_action`,
`geo_action`, `seo_action` raggruppano per dominio con un parametro `action`:

```
competitor     add · update · delete      →  competitor_action
person         add · update · delete      →  person_action
product        create · update · delete   →  product_action
blog_term      add · remove               →  blog_term_action
radar_source   add · remove               →  radar_source_action
article        update · delete            →  article_action
```

### 3. Le impostazioni: 10 tool in 2-3

`set_appearance` · `set_automation` · `set_bio` · `set_blog_settings` · `set_brand_settings` ·
`set_colors` · `set_media_model` · `set_radar_platform` · `update_brand_kit` · `update_voice`

Sono tutte «cambia un'impostazione del brand». Il taglio naturale è per sezione, non per campo.

### Il conto

| | |
|---|---|
| oggi | **125** |
| −22 letture in `query` | 103 |
| −9 (CRUD: 15 → 6) | 94 |
| −7/8 (impostazioni: 10 → 2/3) | **~86** |

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

Quindi le sei famiglie CRUD diventano `*_action` **per creare e aggiornare**, e le 13 operazioni
distruttive restano con il proprio nome, dove si vedono.

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
