# API — 16 · Impostazioni: il blog

Quattro endpoint sotto `/api/v1/brands/:slug/settings/blog`, cioè i tool MCP `get_blog_settings`,
`set_blog_settings`, `add_blog_term` e `remove_blog_term`. Coprono tre pagine di Settings:
`blog-appearance`, `blog-categories`, `blog-authors`.

Errori comuni di auth: vedi [01-overview](01-overview.md).

## Dove è salvato cosa

| cosa | dove |
|---|---|
| aspetto e cadenza | `brands.blog_config` (jsonb) |
| categorie | `blog_categories` (`name`, `slug`, `description`, unico su `(brand_id, slug)`) |
| tag | `blog_tags` (`name`, `slug`, unico su `(brand_id, slug)`) |
| autori | `blog_authors` (`name`, `slug`, `bio`, `role`, `avatar_url`, unico su `(brand_id, slug)`) |

Nessuna migration.

Le chiavi del jsonb sono in camelCase da quando la pagina esiste; l'API parla snake_case come il
resto del registry. La corrispondenza è una tabella sola dentro la rotta.

## Cosa NON si può fare da qui

L'**icona del blog** (`blog_config.iconUrl`) e l'**avatar di un autore** (`blog_authors.avatar_url`)
si impostano solo caricando un file: passano da `readUploadImage`, hanno un tetto di 2 MB e
finiscono nello Storage. Un campo che li accettasse come stringa farebbe salvare una URL che
nessuno ha verificato, quindi non esiste. Un autore creato da qui nasce senza avatar.

## `GET /api/v1/brands/:slug/settings/blog`

Porta tre cose che un agente non può indovinare:

- `choices` — i font (`FONT_KEYS`), i layout, e le 26 lingue di `BLOG_LOCALES`;
- `limits` — `articles_per_week_max` (`blogArticlesPerWeekMax`), `translation_languages`
  (0 sotto Pro), `custom_domain`;
- le tre liste con i loro id, che sono ciò che `update_article` usa per `category_id`,
  `author_id` e `tag_ids`.

`articles_per_week` e `default_locale` tornano `null` quando il brand **non ha scelto**: il
default del piano esiste, ma spacciarlo per una scelta fatta farebbe credere a un agente che il
brand abbia deciso qualcosa che non ha deciso.

## `PUT /api/v1/brands/:slug/settings/blog`

Tutti i campi facoltativi, almeno uno. `locales` e `navbar_links` **sostituiscono** l'intera lista.

Due comportamenti da leggere insieme, perché sono deliberatamente diversi:

- **`articles_per_week` viene RIDOTTA** al tetto del piano, non rifiutata. È ciò che fa il form del
  browser, e due comportamenti diversi per lo stesso campo sarebbero una divergenza. La risposta
  riporta `config`, e la descrizione del tool dice di rileggerlo: un agente che non lo fa crede di
  aver salvato il numero che ha chiesto.
- **una lingua che il blog non serve viene RIFIUTATA** (`unknown_locale`, 400), non scartata.
  Scartarla lascerebbe l'agente convinto di aver acceso una traduzione che non esiste.

Errori: `invalid_input` (400), `no_fields` (400), `unknown_locale` (400), `update_failed` (500).

## `POST /api/v1/brands/:slug/settings/blog/terms`

**Body**: `{ "term": "category" | "tag" | "author", "name": "...", … }`.

Lo slug è **derivato** dal nome (accenti tolti, minuscolo, trattini) e deve essere unico per il
brand: un nome che produce uno slug già presente risponde `slug_taken` (409) invece di appoggiarsi
al vincolo del database e restituire un 500 con dentro un messaggio Postgres.

`description` appartiene a una categoria, `bio` e `role` a un autore, un tag prende solo il nome.
Un campo mandato alla lista sbagliata è `field_not_for_term` (400): scartarlo lascerebbe l'agente
convinto di aver scritto una biografia che non esiste.

Errori: `invalid_input` (400), `field_not_for_term` (400), `empty_slug` (400), `slug_taken` (409),
`insert_failed` (500).

## `POST /api/v1/brands/:slug/settings/blog/terms/remove`

**Body**: `{ "term": "...", "id": "..." }` — l'id verbatim da `get_blog_settings`.

Nessun articolo viene cancellato, ma **ognuna delle tre lascia un segno diverso**, ed è la ragione
per cui la tabella `BLOG_TERMS` esiste in un posto solo:

| voce | vincolo | cosa resta |
|---|---|---|
| categoria | `brand_articles.category_id … on delete set null` | gli articoli restano, senza categoria |
| tag | `brand_article_tags.tag_id … on delete cascade` | il tag sparisce da ogni articolo che lo aveva |
| autore | `brand_articles.author_id … on delete set null` | gli articoli restano, senza firma |

Il conto degli articoli toccati si fa **prima** della cancellazione — dopo, la riga che lo
permetteva non esiste più — e torna come `articles_affected`.

`destructive: true`: è l'unico dei quattro.
