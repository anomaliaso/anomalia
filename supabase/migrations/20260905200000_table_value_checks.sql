-- ── Che cosa è un valore valido, detto dal database ────────────────────────────────────────────
--
-- La RLS regge (544 combinazioni su 548): un utente non tocca i dati di un altro cliente. Dentro
-- il PROPRIO brand però può scrivere qualunque forma di dato, perché le regole su cosa è valido
-- stanno nei tool e non qui. `brand_kit` — l'identità visiva — ha 21 colonne, 3 obbligatorie e
-- zero vincoli: un colore poteva essere una frase, e in produzione uno lo è diventato
-- (`#00502DKEY_PAD_OR_HEX_MATCH_1_#00502D`, un segnaposto di regex finito dentro brand_colors).
--
-- Ogni vincolo qui sotto è stato contato in produzione PRIMA di essere scritto: tutti hanno ZERO
-- righe che li violano. I vincoli con violazioni (products.kind, brand_kit.site_type,
-- brand_kit.theme_color, brand_kit.source_url, posts.content_type) NON sono qui: aspettano una
-- decisione sui dati o una correzione nel codice che li scrive, ed è nel changelog interno.
--
-- Non ci sono tetti di piano né vocabolari di prodotto che cambiano col listino: quelli restano
-- nel codice. `brand_news_sources.lang` è vincolato nella FORMA (due lettere o 'auto'), non
-- nell'elenco delle 12 lingue del menu — l'elenco cambia, la forma no.
--
-- Nessuna tabella supera le 1.800 righe: `add constraint` blocca per millisecondi e `not valid`
-- non serve.

-- ── posts (518 righe) ──────────────────────────────────────────────────────────────────────────
-- `platform`, `platforms` e `format` restano liberi: i percorsi planner/onboarding ci scrivono
-- output del modello non normalizzato, e un CHECK lì fermerebbe l'autopilot di notte.

alter table public.posts
  add constraint posts_status_check
    check (status in ('pending_user', 'approved', 'scheduled', 'published', 'failed')),
  add constraint posts_source_check
    check (source in ('plan', 'manual', 'radar', 'guest_preview')),
  add constraint posts_video_render_status_check
    check (video_render_status in ('rendering', 'done', 'failed')),
  add constraint posts_video_resolution_check
    check (video_resolution in ('480p', '720p', '1080p')),
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
-- `kind` non è qui: 247 righe fuori vocabolario e l'import Shopify ce ne scrive di nuove.

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
    );

-- ── brand_kit (74 righe, era 21 colonne e zero vincoli) ────────────────────────────────────────
-- `theme_color` non è qui: `extractThemeColor` copia il `<meta theme-color>` del sito senza
-- validarlo, e un sito che ci scrive `red` verrebbe rifiutato in onboarding.

alter table public.brand_kit
  add constraint brand_kit_favicon_url_check
    check (favicon_url ~ '^(https?://|data:)'),
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
      and length(site_type) <= 60
      and length(theme_color) <= 40
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
-- `handles` non è vincolato: tre writer ci mettono un array, `chat/job-executor.ts` un oggetto.
-- Prima si sceglie una forma nel codice, poi la si vincola qui.

alter table public.competitors
  add constraint competitors_website_check
    check (website ~ '^https?://'),
  add constraint competitors_json_shape
    check (
      jsonb_typeof(top_posts) = 'array'
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

alter table public.brand_news_sources
  add constraint brand_news_sources_value_check
    check (btrim(value) <> '' and length(value) <= 500),
  add constraint brand_news_sources_lang_check
    check (lang ~ '^([a-z]{2}|auto)$');
