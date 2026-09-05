-- ── Che cosa è un valore valido, detto dal database ────────────────────────────────────────────
--
-- La RLS regge (544 combinazioni su 548): un utente non tocca i dati di un altro cliente. Dentro
-- il PROPRIO brand però può scrivere qualunque forma di dato, perché le regole su cosa è valido
-- stanno nei tool e non qui. `brand_kit` — l'identità visiva — ha 21 colonne, 3 obbligatorie e
-- zero vincoli: un colore poteva essere una frase, e in produzione uno lo è diventato
-- (`#00502DKEY_PAD_OR_HEX_MATCH_1_#00502D`, un segnaposto di regex finito dentro brand_colors).
--
-- Ogni vincolo qui sotto è stato contato in produzione PRIMA di essere scritto: dopo la
-- correzione dei dati in testa al file, tutti hanno ZERO righe che li violano.
--
-- Cinque colonne hanno richiesto una decisione. Quattro sono entrate: `posts.content_type` dopo
-- aver corretto i tre percorsi che ci scrivevano un formato, `brand_kit.theme_color` dopo averlo
-- sanificato in ingresso, `brand_kit.site_type` allargato ai 9 valori legittimi, e
-- `brand_kit.source_url` dopo aver spostato gli handle dove vivono. `products.kind` resta LIBERO:
-- ci scrive l'import Shopify, e vincolarlo romperebbe ogni sincronizzazione di catalogo.
--
-- Non ci sono tetti di piano né vocabolari di prodotto che cambiano col listino: quelli restano
-- nel codice. `brand_news_sources.lang` è vincolato nella FORMA (due lettere o 'auto'), non
-- nell'elenco delle 12 lingue del menu — l'elenco cambia, la forma no, e in produzione c'è già
-- un `tr` che il menu non offre.
--
-- Nessuna tabella supera le 1.800 righe: `add constraint` blocca per millisecondi e `not valid`
-- non serve.

-- ── Prima dei vincoli: il dato giusto nel campo sbagliato ──────────────────────────────────────
--
-- Nove righe di `brand_kit.source_url` non sono URL, e le stesse nove sono anche in
-- `brands.website`. Due NON sono spazzatura: `biohappy` e `Mariopuggelli1939` sono handle veri,
-- scritti dove si chiedeva un sito. Vanno spostati fra gli handle del brand, non annullati — è la
-- stessa regola che `splitWebsiteOrHandle` applica adesso in ingresso.
--
-- La regola, identica al codice: la chiocciola davanti, oppure una parola senza punti e senza
-- schema, è un handle; con uno spazio dentro (`no celo`) non è né un sito né un handle e si butta.
-- I 21 `brands.website` che sono domini nudi (`anomalia.so`, a cui manca solo `https://`) NON si
-- toccano: sono dati buoni e vogliono una decisione loro.

-- `brand_social_handles` è unica su (brand_id, platform), non sullo username: un brand che ha già
-- dichiarato il suo Instagram tiene quello, che è il più affidabile dei due. Senza `on conflict`
-- questa insert alzerebbe un 23505 e farebbe abortire l'intera migration.
insert into public.brand_social_handles (brand_id, platform, username)
select distinct k.brand_id, 'instagram', ltrim(btrim(k.source_url), '@')
from public.brand_kit k
where k.source_url is not null
  and btrim(k.source_url) !~ '^https?://'
  and btrim(k.source_url) !~ '\s'
  and (btrim(k.source_url) like '@%' or btrim(k.source_url) !~ '\.')
  and ltrim(btrim(k.source_url), '@') <> ''
on conflict (brand_id, platform) do nothing;

-- Un dominio nudo non si butta, gli manca solo lo schema — è la regola di `normalizeWebsite`.
-- Oggi nessuna delle nove ha questa forma, ma la migration viene applicata dopo, e nel frattempo
-- una riga nuova può arrivare: annullarla sarebbe perdere un dato buono.
update public.brand_kit
  set source_url = case
    when btrim(source_url) ~ '\.' and btrim(source_url) !~ '\s' then 'https://' || btrim(source_url)
    else null
  end
  where source_url is not null and source_url !~ '^https?://';

update public.brands set website = null
  where website is not null
    and website !~ '^https?://'
    and (btrim(website) = '' or btrim(website) ~ '\s' or btrim(website) !~ '\.');

-- ── posts (518 righe) ──────────────────────────────────────────────────────────────────────────
-- `platform`, `platforms` e `format` restano liberi: i percorsi planner/onboarding ci scrivono
-- output del modello non normalizzato, e un CHECK lì fermerebbe l'autopilot di notte.
-- `uploaded_video` entra nel vocabolario perché `upload-media` lo scrive ed è legittimo; `image`
-- e `carousel` no: erano formati finiti in una colonna di tipi, e il codice è stato corretto.
-- `cross_post` e `founder` in `source` sono la stessa storia: nessuna riga in produzione, ma due
-- percorsi vivi che li scrivono (il clone di `cross_post` e la consegna video dall'admin). Un
-- vincolo che li rifiuta è il vincolo sbagliato, non i dati — li ha trovati la sezione C di
-- `schema-drift-check.mjs`, che confronta i literal del codice con le liste di questo file.
--
-- `external` invece NON lo trova nessun grep di literal: al punto dell'insert
-- (`manual-posting.ts:306`) c'è una variabile, e il valore nasce in
-- `POST /api/v1/brands/:slug/posts`, l'endpoint con cui un agente esterno deposita un post. La
-- fonte vera è il tipo `PostAuthorship`, e ora `POST_SOURCES` in `contracts/post-tools.ts` è
-- l'elenco unico da cui questo `check` è derivato — con un test che fallisce se i due divergono.
--
-- `video_resolution` non ha un vocabolario ma una FORMA: il valore arriva da
-- `KIE_VIDEO_RESOLUTION` / `KIE_VIDEO_UPSCALE_RESOLUTION`, cioè da configurazione. Un elenco
-- chiuso qui si romperebbe al primo cambio di env, che è la stessa ragione per cui i tetti di
-- piano non stanno nel database.

alter table public.posts
  add constraint posts_status_check
    check (status in ('pending_user', 'approved', 'scheduled', 'published', 'failed')),
  add constraint posts_content_type_check
    check (content_type in (
      'generated_image', 'generated_video', 'generated_graphic',
      'uploaded_image', 'uploaded_video', 'text', 'link'
    )),
  add constraint posts_source_check
    check (source in ('plan', 'manual', 'radar', 'guest_preview', 'cross_post', 'founder', 'external')),
  add constraint posts_video_render_status_check
    check (video_render_status in ('rendering', 'done', 'failed')),
  add constraint posts_video_resolution_check
    check (video_resolution ~ '^[0-9]{3,4}p$'),
  add constraint posts_video_duration_check
    check (video_duration_seconds > 0 and video_duration_seconds <= 3600),
  add constraint posts_revisions_count_check
    check (revisions_count >= 0),
  add constraint posts_media_url_check
    check (media_url ~ '^https?://'),
  add constraint posts_media_urls_shape
    check (jsonb_typeof(media_urls) = 'array'),
  add constraint posts_text_len
    check (
      length(caption) <= 10000
      and length(title) <= 500
      and length(image_prompt) <= 20000
      and length(first_comment) <= 5000
      and length(slot) <= 100
      and length(pillar) <= 500
      and length(angle) <= 1000
      and length(format) <= 60
      and length(attention_reason) <= 2000
      and length(campaign_name) <= 200
      and length(campaign_step) <= 200
      and length(product_name) <= 500
      and length(subreddit) <= 100
    );

-- ── products (1.799 righe) ─────────────────────────────────────────────────────────────────────
-- `kind` NON ha un vocabolario, per decisione: l'import Shopify ci scrive il `product_type` del
-- merchant (`18k gold`), e vincolarlo farebbe fallire ogni sincronizzazione di catalogo. Le 247
-- righe fuori dai quattro valori attesi non sono dati rotti, sono i nomi di categoria di un
-- gioielliere. Resta il tetto di lunghezza.

alter table public.products
  add constraint products_title_check
    check (btrim(title) <> '' and length(title) <= 500),
  add constraint products_url_check
    check (url ~ '^https?://'),
  add constraint products_images_shape
    check (jsonb_typeof(images) = 'array'),
  add constraint products_text_len
    check (
      length(description) <= 50000
      and length(pricing) <= 200
      and length(external_id) <= 200
      and length(kind) <= 200
    );

-- ── brand_kit (74 righe, era 21 colonne e zero vincoli) ────────────────────────────────────────
-- `theme_color` si può vincolare adesso perché `brand-analysis` lo fa passare da
-- `sanitizeThemeColor`: il `<meta theme-color>` del sito ammette `red`, che è HTML valido e non è
-- un colore che sappiamo usare. Stessa notazione della palette.
-- `site_type` sale da 6 a 9: `media`, `mobile_app` e `service` erano valori legittimi che
-- mancavano dall'elenco, non dati rotti.

alter table public.brand_kit
  add constraint brand_kit_favicon_url_check
    check (favicon_url ~ '^(https?://|data:)'),
  add constraint brand_kit_source_url_check
    check (source_url ~ '^https?://'),
  add constraint brand_kit_theme_color_check
    check (theme_color ~ '^#[0-9a-fA-F]{3,8}$'),
  add constraint brand_kit_site_type_check
    check (site_type in (
      'ecommerce', 'saas', 'portfolio', 'local_service', 'creator',
      'media', 'mobile_app', 'service', 'generic'
    )),
  add constraint brand_kit_json_shape
    check (
      jsonb_typeof(brand_colors) = 'array'
      and jsonb_typeof(logos) = 'array'
      and jsonb_typeof(fonts) = 'array'
      and jsonb_typeof(images) = 'array'
      and jsonb_typeof(content_pillars) = 'array'
      and jsonb_typeof(ai_character) = 'object'
      and jsonb_typeof(graphic_style) = 'object'
    ),
  add constraint brand_kit_text_len
    check (
      length(category) <= 200
      and length(about) <= 20000
      and length(brand_style) <= 5000
      and length(target_audience) <= 5000
      and length(visual_style) <= 50000
      and length(ai_context) <= 200000
    );

-- ── brand_articles (161 righe) ─────────────────────────────────────────────────────────────────
-- `body_md` ammette la stringa vuota: un articolo 'planned' nasce senza corpo (36 righe).

alter table public.brand_articles
  add constraint brand_articles_status_check
    check (status in ('planned', 'draft', 'approved', 'published')),
  add constraint brand_articles_source_check
    check (source in ('plan', 'radar', 'seo', 'ai', 'manual')),
  add constraint brand_articles_slug_check
    check (slug ~ '^[a-z0-9-]+$' and length(slug) <= 200),
  add constraint brand_articles_title_check
    check (btrim(title) <> '' and length(title) <= 500),
  add constraint brand_articles_version_seq_check
    check (version_seq >= 0),
  add constraint brand_articles_cover_image_check
    check (cover_image ~ '^https?://'),
  add constraint brand_articles_text_len
    check (
      length(body_md) <= 500000
      and length(meta_title) <= 300
      and length(meta_description) <= 1000
      and length(language) <= 60
    );

-- ── content_plans (181 righe) ──────────────────────────────────────────────────────────────────

alter table public.content_plans
  add constraint content_plans_status_check
    check (status in ('draft', 'proposed', 'produced')),
  add constraint content_plans_source_check
    check (source in ('manual', 'manual_single', 'manual_trigger', 'scheduled_cron', 'radar')),
  add constraint content_plans_editorial_week_check
    check (editorial_week >= 0 and editorial_week <= 52),
  add constraint content_plans_seeds_shape
    check (jsonb_typeof(seeds) = 'object'),
  add constraint content_plans_title_len
    check (length(title) <= 300);

-- ── people (3 righe) ───────────────────────────────────────────────────────────────────────────
-- `import_unattested` è il quarto valore: lo scrive l'import di onboarding, saltando
-- `personConsentColumns()`. È legittimo, quindi entra nel vincolo.

alter table public.people
  add constraint people_consent_source_check
    check (consent_source in ('owner_attested', 'ai_generated', 'legacy_assumed', 'import_unattested')),
  add constraint people_images_shape
    check (jsonb_typeof(images) = 'array'),
  add constraint people_name_check
    check (btrim(name) <> '' and length(name) <= 200),
  add constraint people_text_len
    check (length(role) <= 200 and length(description) <= 20000);

-- ── competitors (202 righe) ────────────────────────────────────────────────────────────────────
-- `handles` è un array di `{platform, username, profileUrl}`, e non è una preferenza: ENTRAMBI i
-- lettori (`pickHandles`, `normalizeHandles`) tornano vuoto su qualunque cosa non sia un array,
-- quindi l'oggetto che `chat/job-executor.ts` scriveva era invisibile a tutto il prodotto.
-- Corretto lì, vincolato qui. È anche la forma di `brand_social_handles`, che è dove vivono
-- gli handle del brand.

-- `chat/job-executor.ts` fa `upsert(..., { onConflict: 'brand_id,name' })` su questa tabella, ma
-- l'unico indice unico e' la primary key: Postgres risponde 42P10 («no unique or exclusion
-- constraint matching the ON CONFLICT specification») e la chiamata non legge `error`. Il job
-- "ri-cerca i concorrenti" riporta i concorrenti trovati e scrive ZERO righe, in silenzio. Il
-- vincolo che mancava e' questo, non una correzione nel writer: 0 duplicati su (brand_id, name)
-- in produzione, anche ignorando maiuscole e spazi.
alter table public.competitors
  add constraint competitors_brand_id_name_key unique (brand_id, name);

alter table public.competitors
  add constraint competitors_website_check
    check (website ~ '^https?://'),
  add constraint competitors_json_shape
    check (
      jsonb_typeof(handles) = 'array'
      and jsonb_typeof(top_posts) = 'array'
      and jsonb_typeof(top_ads) = 'array'
      and jsonb_typeof(benchmark) = 'object'
    ),
  add constraint competitors_name_check
    check (btrim(name) <> '' and length(name) <= 300),
  add constraint competitors_rationale_len
    check (length(rationale) <= 20000);

-- ── brand_memory (1.461 righe) ─────────────────────────────────────────────────────────────────

alter table public.brand_memory
  add constraint brand_memory_key_check
    check (btrim(key) <> '' and length(key) <= 200),
  add constraint brand_memory_value_check
    check (btrim(value) <> '' and length(value) <= 50000),
  add constraint brand_memory_counters_check
    check (times_reinforced >= 0 and times_used >= 0);

-- ── brand_sites (4 righe) ──────────────────────────────────────────────────────────────────────
-- Stessa forma che `normalizeHost` già impone nel codice: minuscolo, senza schema, senza porta,
-- senza path, almeno un punto. Postgres non ha il lookahead, quindi il "non inizia per -" è
-- scritto nella classe di caratteri.

alter table public.brand_sites
  add constraint brand_sites_host_check
    check (
      host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      and length(host) <= 253
    );

-- ── brand_news_sources (265 righe) ─────────────────────────────────────────────────────────────

-- `lang` è una FORMA, non l'elenco delle 12 voci del menu: il form
-- (`settings/radar/+page.server.ts:83`) prende il valore grezzo e lo taglia a 5 caratteri senza
-- allowlist, quindi un `pt-BR` arriva alla colonna. In produzione c'è già un `tr` che il menu non
-- offre. Due-cinque lettere o trattino: blocca la spazzatura, non blocca il form.
alter table public.brand_news_sources
  add constraint brand_news_sources_value_check
    check (btrim(value) <> '' and length(value) <= 500),
  add constraint brand_news_sources_lang_check
    check (lang ~ '^[A-Za-z-]{2,5}$');
