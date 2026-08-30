# API — 07 · Growth: SEO / GEO / web

SEO, GEO, keywords, backlink network, blog, GSC, rank tracking, content library, video review.
Errori comuni di auth: vedi [01-overview](01-overview.md).

## `GET /api/v1/brands/:slug/seo`

Ultimo audit SEO, piano SEO, asset in bozza e metriche aggregate calcolate dagli audit.

**Query params**: nessuno

**Response** `200` (blocchi `tech`, `search`, `backlinks`, `evaluation`, `initiatives` dinamici):

```json
{
  "audit": {
    "tech_score": 61,
    "tech": { "issues": ["<dati audit tech dinamici>"] },
    "search": { "estMonthlyTraffic": 4200, "organicKeywords": 380, "keywordsTop10": 12, "history": [] },
    "backlinks": { "rank": 42, "referringDomains": 87, "backlinks": 512 },
    "created_at": "2026-08-10T08:00:00Z"
  },
  "plan": {
    "grade": "B",
    "evaluation": { "summary": "<testo dinamico>" },
    "initiatives": [ { "id": "00000000-0000-0000-0000-000000000000", "title": "<dinamico>" } ],
    "created_at": "2026-08-11T09:00:00Z"
  },
  "assets": {
    "00000000-0000-0000-0000-000000000000": {
      "id": "11111111-1111-1111-1111-111111111111",
      "kind": "blog_article",
      "title": "<dinamico>",
      "format": "markdown",
      "target_path": "/blog/<slug>",
      "source_finding": "seo:00000000-0000-0000-0000-000000000000"
    }
  },
  "metrics": {
    "domainRating": 42,
    "traffic": 4200,
    "organicKeywords": 380,
    "keywordsTop10": 12,
    "keywordsNew": null,
    "keywordsLost": null,
    "referringDomains": 87,
    "backlinks": 512,
    "spamScore": null,
    "dofollow": null,
    "nofollow": null,
    "referringPages": null,
    "topTlds": [],
    "trend": [ { "label": "2026-07", "traffic": 3900, "domainRating": 41 } ],
    "newTopKeywords": [],
    "backlinkSummary": null,
    "search": null
  }
}
```

Note: `audit`, `plan`, `assets` possono essere `null`/`{}` senza dati.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/seo" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/seo`

Azioni SEO/AI: audit tecnico, piano, iniziative extra, generazione asset o articolo. **Consuma crediti** (tutte le action).

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `action` | string | No (default `audit`) | `audit` \| `plan` \| `more` \| `asset` \| `article` |
| `initiativeId` | string | Sì per `asset` e `article` | UUID dell'iniziativa del piano SEO |
| `guidance` | string | No (solo `more`) | Linee guida per nuove iniziative, max 500 char |

**Response** `200` — per azione:

```json
{ "ok": true, "techScore": 61 }                                     // audit
{ "ok": true, "grade": "B", "initiatives": 8 }                      // plan
{ "ok": true, "added": 3 }                                          // more
{ "ok": true, "generated": 1 }                                      // asset
{ "ok": true, "articleId": "11111111-1111-1111-1111-111111111111" } // article
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"Missing initiativeId"}` |
| `400` | `{"error":"Unknown action: <action>"}` |
| `502` | `{"error":"Audit failed — site unreachable or no prompts"}` |
| `502` | `{"error":"Could not generate the SEO plan"}` |
| `502` | `{"error":"Could not add initiatives"}` |
| `502` | `{"error":"Could not generate the asset"}` |
| `502` | `{"error":"Could not generate the article"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/seo" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"asset","initiativeId":"00000000-0000-0000-0000-000000000000"}'
```

---

## `GET /api/v1/brands/:slug/geo`

Audit GEO (visibility AI), AI overview, trend storico e artefatti di fix in bozza.

**Query params**: nessuno

**Response** `200` (dati AI dinamici):

```json
{
  "audit": {
    "tech_score": 58,
    "tech": { "issues": ["<dinamico>"] },
    "share_of_voice": 0.42,
    "citations": [ { "source": "<dinamico>", "text": "<dinamico>" } ],
    "ai_overview": { "mentionsBrand": true, "summary": "<dinamico>" },
    "created_at": "2026-08-10T08:00:00Z"
  },
  "aiOverview": { "mentionsBrand": true, "summary": "<dinamico>" },
  "trend": [
    { "techScore": 55, "shareOfVoice": 0.38, "at": "2026-08-03T08:00:00Z" },
    { "techScore": 58, "shareOfVoice": 0.42, "at": "2026-08-10T08:00:00Z" }
  ],
  "artifacts": [
    { "id": "22222222-2222-2222-2222-222222222222", "kind": "profile", "title": "<dinamico>", "format": "text", "target_path": null, "source_finding": "geo:<id>" }
  ]
}
```

Note: `audit` e `aiOverview` possono essere `null`.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/geo" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/geo`

Nuovo audit GEO o generazione artefatti di fix dall'ultimo audit. **Consuma crediti.**

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `action` | string | No (default `audit`) | `audit` \| `fix` |

**Response** `200`:

```json
{ "ok": true, "techScore": 58, "shareOfVoice": 0.42 }   // audit
{ "ok": true, "generated": 4 }                           // fix
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"Run an audit first"}` (fix senza audit) |
| `400` | `{"error":"Unknown action: <action>"}` |
| `502` | `{"error":"Audit failed — site unreachable or no prompts"}` |
| `502` | `{"error":"Nothing to generate — no addressable gaps"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/geo" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"fix"}'
```

---

## `GET /api/v1/brands/:slug/keywords`

Keyword strategy del brand (ricerca AI/DataForSEO) con citazioni di grounding.

**Query params**: nessuno

**Response** `200` (contenuto AI — placeholder):

```json
{
  "strategy": {
    "focusSummary": "<riassunto strategico dinamico>",
    "keywords": [
      {
        "keyword": "esempio keyword",
        "intent": "informational",
        "opportunity": "high",
        "rationale": "<dinamico>",
        "action": "Create content that targets this keyword.",
        "volume": 2900,
        "difficulty": 12,
        "cpc": 1.4,
        "competition": 0.21
      }
    ],
    "competitorGaps": [ { "competitor": "<nome>", "gap": "<dinamico>" } ]
  },
  "citations": ["<dinamico>"],
  "updatedAt": "2026-08-12T10:00:00Z"
}
```

Note: `strategy` può essere `null`, `citations` `[]`, `updatedAt` `null` se mai generata.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/keywords" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/keywords`

Rigenera da zero la keyword strategy (force). **Consuma crediti.**

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "keywords": 24 }
```

**Errori specifici**: `502` `{"error":"Could not generate keyword research"}`

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/keywords" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/backlinks`

Riepilogo della backlink network: piazzamenti in uscita/entrata, opportunità open e statistiche.

**Query params**: nessuno

**Response** `200`:

```json
{
  "enabled": true,
  "planAllowed": true,
  "unlocked": true,
  "outgoing": [
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "sourceBrandId": "44444444-4444-4444-4444-444444444444",
      "sourceArticleId": "55555555-5555-5555-5555-555555555555",
      "targetBrandId": "66666666-6666-6666-6666-666666666666",
      "targetArticleId": null,
      "targetUrl": "https://altro-brand.it/blog/articolo",
      "anchorText": "esempio anchor",
      "status": "draft",
      "createdAt": "2026-08-01T09:00:00Z",
      "partnerName": "Altro Brand"
    }
  ],
  "incoming": [],
  "opportunities": [
    {
      "id": "77777777-7777-7777-7777-777777777777",
      "direction": "give",
      "partnerBrandId": "66666666-6666-6666-6666-666666666666",
      "partnerBrandName": "Altro Brand",
      "partnerArticleId": "88888888-8888-8888-8888-888888888888",
      "partnerUrl": "https://altro-brand.it/blog/articolo",
      "partnerTitle": "Titolo articolo partner",
      "relevance": 62,
      "suggestedAnchor": "suggerimento anchor",
      "rationale": "<dinamico>",
      "status": "open",
      "createdAt": "2026-08-12T08:00:00Z"
    }
  ],
  "stats": {
    "outgoingCount": 1,
    "incomingCount": 0,
    "openGive": 1,
    "openReceive": 0
  }
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/backlinks" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/backlinks`

Rigenera le opportunità open give/receive. **Consuma crediti**, richiede piano Starter+.

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "give": 6, "receive": 4 }
```

**Errori specifici**

| Status | Body |
|---|---|
| `402` | `{"error":"Backlink network requires Starter or above","code":"plan_required","upgrade":"starter"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/backlinks" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/web`

Lista articoli blog **con draft inclusi** (a differenza di `/articles`). Senza `status` restituisce tutti.

**Query params**

| Param | Tipo | Default | Descrizione |
|---|---|---|---|
| `status` | string | (tutti) | `draft` \| `published` \| `scheduled` \| `all` |

**Response** `200` (nomi campi snake_case):

```json
{
  "articles": [
    {
      "id": "99999999-9999-9999-9999-999999999999",
      "slug": "mio-articolo",
      "title": "Titolo articolo",
      "meta_title": "Meta title",
      "meta_description": "Meta description",
      "status": "draft",
      "scheduled_for": null,
      "published_at": null,
      "source_initiative_id": "00000000-0000-0000-0000-000000000000",
      "created_at": "2026-08-12T09:00:00Z"
    }
  ]
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/web?status=draft" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/web`

Azioni sugli articoli: generazione, ottimizzazione SEO, pubblicazione, depubblicazione, eliminazione. `generate`/`optimize` **consumano crediti**; le azioni di stato richiedono solo write access.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `action` | string | Sì | `generate` \| `optimize` \| `publish` \| `unpublish` \| `delete` |
| `topic` | string | Sì per `generate` | Argomento dell'articolo |
| `id` | string | Sì per `optimize`/`publish`/`unpublish`/`delete` | UUID articolo |

**Response** `200` — per azione:

```json
{ "ok": true, "articleId": "99999999-9999-9999-9999-999999999999" }  // generate
{ "ok": true }                                                        // optimize, delete
{ "ok": true, "status": "published" }                                 // publish
{ "ok": true, "status": "draft" }                                     // unpublish
```

Note: `publish` attiva anche l'indicizzazione istantanea (IndexNow + Exa), fire-and-forget.

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"Missing id"}` |
| `400` | `{"error":"Missing topic"}` |
| `400` | `{"error":"Unknown action: <action>"}` |
| `500` | `{"error":"<messaggio errore DB>"}` |
| `502` | `{"error":"Could not generate the article"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/web" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"generate","topic":"come scegliere il CRM giusto"}'
```

---

## `GET /api/v1/brands/:slug/articles`

API headless read-only: elenca SOLO gli articoli **pubblicati** (riepilogo, senza corpo). Paginata.

**Query params**

| Param | Tipo | Default | Descrizione |
|---|---|---|---|
| `limit` | number | 50 | Min 1, max 100 |
| `offset` | number | 0 | Offset paginazione |

**Response** `200`:

```json
{
  "articles": [
    {
      "id": "99999999-9999-9999-9999-999999999999",
      "slug": "mio-articolo",
      "title": "Titolo articolo",
      "metaTitle": "Meta title",
      "metaDescription": "Meta description",
      "coverImage": "https://...",
      "publishedAt": "2026-08-10T07:30:00Z"
    }
  ],
  "total": 14,
  "limit": 50,
  "offset": 0
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/articles?limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/articles/:id`

Contenuto completo di un articolo pubblicato: markdown + HTML renderizzato + Article JSON-LD. Accetta UUID **o** slug in `{id}`.

**Query params**: nessuno

**Response** `200`:

```json
{
  "id": "99999999-9999-9999-9999-999999999999",
  "slug": "mio-articolo",
  "title": "Titolo articolo",
  "metaTitle": "Meta title",
  "metaDescription": "Meta description",
  "coverImage": "https://...",
  "publishedAt": "2026-08-10T07:30:00Z",
  "contentMarkdown": "# Titolo\n\n<corpo markdown>",
  "contentHtml": "<h1>Titolo</h1><p><corpo html></p>",
  "jsonLd": {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "Titolo articolo",
    "description": "Meta description",
    "image": "https://...",
    "datePublished": "2026-08-10T07:30:00Z"
  }
}
```

**Errori specifici**: `404` `{"error":"Article not found"}`

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/articles/mio-articolo" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/gsc`

Riepilogo Google Search Console: stato connessione + metriche aggregate 28 giorni (top query e pagine, max 20 ciascuna).

**Query params**: nessuno

**Response** `200`:

```json
{
  "connected": true,
  "configured": true,
  "siteUrl": "sc-domain:example.com",
  "syncedAt": "2026-08-12T04:00:00Z",
  "lastError": null,
  "clicks28d": 1520,
  "impressions28d": 41000,
  "topQueries": [
    { "query": "esempio query", "clicks": 240, "impressions": 5000, "position": 4.2 }
  ],
  "topPages": [
    { "page": "https://example.com/blog/articolo", "clicks": 310, "impressions": 7200, "position": 5.1 }
  ]
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/gsc" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/gsc`

Sincronizza le metriche Search Analytics degli ultimi 3 giorni dalla property GSC connessa.

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "rows": 312 }
```

**Errori specifici** (status `502`)

| Body |
|---|
| `{"error":"GSC not connected"}` |
| `{"error":"GSC refresh token missing — reconnect"}` |
| `{"error":"GSC site not selected"}` |
| `{"error":"GSC sync failed: <dettaglio API Google>"}` |
| `{"error":"GSC metrics upsert: <errore DB>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/gsc" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/ranks`

Rank board: keyword tracciate attive con posizione attuale, precedente e delta.

**Query params**: nessuno

**Response** `200`:

```json
{
  "keywords": [
    {
      "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "keyword": "esempio keyword",
      "locale": "it",
      "device": "desktop",
      "source": "strategy",
      "active": true,
      "position": 6,
      "prevPosition": 9,
      "delta": 3,
      "url": "https://example.com/pagina",
      "checkedAt": "2026-08-12T02:00:00Z",
      "hasAiOverview": true
    }
  ]
}
```

Note: `delta` positivo = miglioramento. `position`/`prevPosition`/`delta`/`url`/`checkedAt` possono essere `null`.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/ranks" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/ranks`

Aggiunge keyword al tracking (fonte `manual`) e/o esegue subito un batch di check SERP DataForSEO. Non richiede gate crediti.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `keywords` | string[] | No | Keyword da tracciare (lowercase, deduplicate) |
| `check` | boolean | No | Se truthy esegue subito un batch di check (max 50 keyword) |

**Response** `200`:

```json
{ "ok": true, "checked": 12 }
```

Senza `check`, con keyword inserite:

```json
{
  "keywords": [
    { "id": "aaa…", "keyword": "esempio", "locale": "it", "device": "desktop", "source": "manual", "active": true, "position": null, "prevPosition": null, "delta": null, "url": null, "checkedAt": null, "hasAiOverview": false }
  ]
}
```

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/ranks" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"keywords":["esempio keyword 1","esempio keyword 2"],"check":true}'
```

---

## `POST /api/v1/brands/:slug/library/scan`

Crawla il sito del brand (sitemap → pagine → estrazione meta/testo → arricchimento AI) e upserta le pagine in `brand_pages`. Richiede write access, nessun gate crediti.

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "pages": 34 }
```

Note: `pages` è `0` se manca l'URL del sito, la sitemap è vuota o nessuna pagina supera la soglia di contenuto.

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/library/scan" \
  -H "Authorization: Bearer $TOKEN"
```
