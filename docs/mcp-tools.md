# I tool MCP di Anomalia — inventario e piano di aggregazione

**119 tool.** 111 dichiarati nel registro dei contratti, 8 registrati a mano.
42 sono letture. 17 distruggono qualcosa.

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
| *«rendi rossa questa foto»* | ne ha **disegnata una nuova** — `refine_image` era nella lista |
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
| **Anomalia** | **119** | |

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
Estratto dal registro — **111 tool**. Altri 8 sono registrati a mano in `cli/mcp/tools/`: `list_brands`, `get_status`, `approve_post`, `approve_posts`, `reject_post`, `publish_post`, `produce_week`, `generate_person`.

> Il numero si muove: fra la prima stesura di questo documento e la sua revisione, novanta minuti dopo,
> `generate_captions` e `generate_carousel` sono entrati. Per questo l'inventario si rigenera invece
> di mantenersi — e per questo porta il commit da cui è stato estratto.


### `/studio` — 14 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `add_competitor` | POST | `name`, `website`?, `rationale`? |  |
| `add_note` | POST | `text`, `title`? |  |
| `add_person` | POST | `name`, `role`?, `description`?, `consent` |  |
| `create_product` | POST | `title`, `description`?, `pricing`?, `url`?, `kind`?, `featured`? |  |
| `delete_competitor` | DELETE | `id` | ⚠︎ |
| `delete_document` | DELETE | `id` | ⚠︎ |
| `delete_person` | DELETE | `id` | ⚠︎ |
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

### `/web` — 11 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
| `delete_article` | DELETE | `id` | ⚠︎ |
| `generate_article` | POST | `topic` |  |
| `get_article` | GET | `id` |  |
| `get_audit_findings` | GET | `audit_id`? |  |
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
| `refine_image` | POST | `base_media_id`, `instruction`, `count`?, `model`?, `title`? |  |

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

### `/memory` — 2 tool

| tool | metodo | parametri | dist. |
|---|---|---|---|
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

### 1. Le letture: quattro sparivano dentro `query`, non ventidue

Questa sezione diceva che 22 letture erano una tabella e un filtro. **Non è vero, ed è stato
misurato invece che stimato**: aperti tutti i 44 handler GET del registro, 40 fanno lavoro che
`query` non fa in una chiamata. Quattro erano davvero un `select`, e sono state tolte.

**Il criterio, e non è il nome.** Si toglie quando l'handler è un `select` su una tabella che
`query` sa nominare, con filtri e ordinamenti che i suoi operatori esprimono. Si tiene quando
aggrega o unisce tabelle a mano, chiama un servizio esterno, applica una regola di piano che la
riga grezza non porta, o quando la riga grezza è più larga dei tetti di `query`.

**I tetti sono la cosa che decide.** `query` taglia a 20.000 caratteri per risposta e 2.000 per
valore singolo. Misurato sullo stack locale, 60 post con didascalie da 539 caratteri (la lunghezza
vera, non inventata):

| lettura | righe che tornano |
|---|---|
| `list_posts`, 17 colonne, nessun tetto | **50 su 50** (63.471 caratteri) |
| `query` con le stesse 17 colonne | **15 su 50** — il tetto morde |
| `query` senza `columns` (`select *`, 54 colonne) | **9 su 50** |

Su `brand_articles` lo stesso confronto dà **payload identico byte per byte, 20 righe su 20** — ma
solo a colonne nominate: senza, `body_md` entra nella riga e ne sopravvive **una**. Da qui la
regola che sta nelle `MCP_INSTRUCTIONS` e nella skill: **nomina le colonne, o il tetto si mangia la
risposta senza dirlo.**

#### Tolte — 4

| tool | cosa faceva l'handler | come si legge adesso |
|---|---|---|
| `get_appearance` | `select` di 6 colonne su `brand_kit`, 736 caratteri misurati; l'unica regola era scartare il logo `og-image`, che la riga dichiara da sé | `query({table:"brand_kit", columns:["logos","favicon_url","brand_colors","graphic_style","visual_style","visual_style_locked"]})` |
| `list_articles` | `select` di 10 colonne di metadati su `brand_articles`, niente corpo, niente calcolo | `query({table:"brand_articles", columns:["id","slug","title","status","scheduled_for","published_at","created_at"]})` |
| `list_ideas` | `select` su `disruptive_ideas` con `status in (new, shortlisted)` per difetto | `query({table:"disruptive_ideas", columns:["id","title","idea","device","score","status"], where:[{column:"status",op:"in",value:["new","shortlisted"]}], order:{column:"score",ascending:false}})` |
| `get_memory` | `select` su `brand_memory` con `layer != session` e `agent is null` | `query({table:"brand_memory", columns:["id","key","value","category","confidence"], where:[{column:"layer",op:"neq",value:"session"},{column:"agent",op:"is",value:null}], order:{column:"confidence",ascending:false}})` |

Le **rotte REST restano tutte e quattro**: la CLI le chiama (`anomalia web`, `anomalia ideas`), e
`resolveArticleId` risolve i prefissi degli id degli articoli passando da `GET /web`, quindi i
prefissi continuano a funzionare anche senza il tool.

**Due sono passate per un pelo, e la differenza va detta invece di nascosta:**

- `list_ideas` — `query` ordina su **una** colonna sola. Il tool rompeva la parità di punteggio col
  più recente; ora quelle idee tornano nell'ordine che sceglie il planner.
- `get_memory` — `query` si ferma a **100 righe**, il tool arrivava a 200. E i suoi due filtri, che
  l'handler imponeva, ora sono *dichiarati*: chi li omette rivede le note di sessione e quelle di
  mestiere degli altri agenti. Non è una fuga — la RLS non è cambiata, sono righe dei brand di chi
  legge — ma è rumore che prima non arrivava.

#### Tenute — 40, e il motivo cambia per gruppo

| perché resta | tool |
|---|---|
| **aggregano o uniscono tabelle a mano** | `get_dashboard` (10 conteggi in parallelo), `get_analytics`, `get_gtm`, `get_plan`, `get_weekly_plan`, `get_studio`, `get_seo`, `get_geo`, `get_goals`, `get_ranks`, `get_gsc`, `get_backlinks`, `get_market_field`, `get_knowledge_status`, `get_calendar`, `get_voice`, `check_media_job`, `list_web_audits`, `list_audit_citations`, `get_audit_findings`, `get_creation_kit`, `get_bio` |
| **escono dall'edificio** — servizio esterno o sorgenti riprese dal vivo | `diagnose_radar`, `get_ads`, `search_knowledge` |
| **applicano una regola che la riga nuda non porta** — tetti di piano, cataloghi definiti nel codice | `diagnose_brand`, `get_automations`, `get_media_models`, `get_radar`, `get_blog_settings`, `get_brand_settings`, `list_social_accounts`, `get_writing_skills` |
| **`query` le taglierebbe** — corpo, jsonb o snapshot più larghi dei tetti | `list_posts`, `get_article`, `list_web_fixes`, `get_keywords`, `list_shares`, `get_post`, `list_media` |

`list_media` e `get_post` restano anche per un motivo che la riga non dà: coniano l'indirizzo
pubblico da `short_code` e risolvono l'origine di ogni slide. `get_appearance` era in questo
gruppo per errore — i suoi logo sono `getPublicUrl`, già pubblici nella riga.

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
| −3 tool di autenticazione (`login`, `logout`, `whoami`) | **119** |

E finisce lì, salvo `generate_media` — l'unica cancellazione a cui questo documento si impegnava
già, in corso su un altro ramo.

Le due righe che stavano qui — «−9 se il CRUD va da 15 a 6», «−7/8 se le impostazioni vanno da 10 a
2/3» — erano stime scritte prima di aprire gli handler, come lo era «−22 letture in
`query`»: aperti i 44 handler di lettura, quelle davvero coperte erano quattro; aperti i 72 di
scrittura, le famiglie da collassare sono zero.

**Il numero non è il bersaglio.** I sette tolti non servivano o mentivano. I 119 che restano sono
capacità, e una capacità nascosta in un enum resta nella lista: cambia solo che nessuno la trova.

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

`packages/api-contracts/src/findability.test.ts` esiste già: una tabella che mappa **la richiesta
arrivata davvero in chat** → il tool che le deve una risposta → le parole che la descrizione deve
contenere. Gira su descrizioni, skill e istruzioni del server.

**Il piano di aggregazione va eseguito contro quel test.** Se dopo il raggruppamento «aggiungi un
concorrente» non arriva più a destinazione, il guadagno non c'è: abbiamo solo spostato la confusione
da una lista lunga a un enum illeggibile.

---

## Cosa manca ancora, al momento di questa revisione

| | stato |
|---|---|
| `refine_video` | **non esiste su nessun branch.** Bloccato finché `transformVideo` non prende la forma del lavoro: oggi è sincrono da capo a fondo, con polling fino a 600s, e esporlo così terrebbe appeso un client MCP per dieci minuti |
| `upscale_video` | progettato, non scritto. Tool suo e non parametro, perché l'ingrandimento di kie prende il `task_id` del lavoro originale e non tocca la libreria, mentre quello di OpenRouter prende un URL: **non sono la stessa capacità con due trasporti** |
| `upscale_image` | **nessun modello lo fa su OpenRouter** — verificati tutti e 50. Chiedere a un modello di generazione di «rifare l'immagine più grande» è una rigenerazione, non un ingrandimento: torna un'immagine *diversa* a risoluzione maggiore |

I tool per **modificare** un carosello non ci sono di proposito: `generate_carousel` vive sotto
`/media/carousel` e restituisce la sequenza intera — N id di media più i `continuity_tokens` — senza
creare nessun post. Quindi l'array è dell'agente: riordinare è l'ordine degli argomenti a
`create_post`, togliere è ometterne uno, cambiare una slide è `refine_image` sul suo id, aggiungerne
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
