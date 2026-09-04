# API — 08 · Ads, voice, GTM e gestione

Ads (campagne + remix), voice framework, piano GTM, rubriche, prodotti, API key, banco
idee, field watch e diagnosi del Radar.
Errori comuni di auth: vedi [01-overview](01-overview.md).

## `GET /api/v1/brands/:slug/ads`

Riepilogo campagne paid (campagne, totali, serie storica), candidati al boost (post organici vincenti) e ad account Zernio collegati.

**Query params**

| Param | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `sync` | string | No | Se `=1`, esegue prima `syncAdAccounts` + `syncAdMetrics` (best-effort) |

**Response** `200`:

```json
{
  "summary": {
    "campaigns": [
      {
        "id": "uuid",
        "name": "Boost · Provate il nostro kit",
        "platform": "metaads",
        "ad_type": "boost",
        "status": "active",
        "goal": "engagement",
        "budget_amount": 12,
        "budget_type": "daily",
        "currency": "EUR",
        "review_status": null,
        "proposal_reason": null,
        "post_id": "uuid",
        "created_at": "2026-08-01T10:00:00Z",
        "approved_at": "2026-08-02T09:00:00Z",
        "zernio_ad_id": "12345",
        "external_ids": { "creditedSpend": 4.2 },
        "error": null,
        "metrics": {
          "campaign_id": "uuid",
          "spend": 4.2,
          "impressions": 2100,
          "clicks": 88,
          "reach": 1900,
          "ctr": 4.19,
          "cpc": 0.05,
          "cpm": 2.0,
          "conversions": 2,
          "roas": null,
          "period_start": "2026-08-02",
          "period_end": "2026-08-13",
          "synced_at": "2026-08-13T08:00:00Z"
        },
        "source": "anomalia"
      }
    ],
    "totals": { "spend": 4.2, "impressions": 2100, "clicks": 88, "reach": 1900, "conversions": 2, "active": 1, "proposed": 2 },
    "series": [
      { "date": "2026-08-13", "spend": 4.2, "impressions": 2100, "clicks": 88 }
    ],
    "accountAds": []
  },
  "candidates": [
    {
      "postId": "uuid",
      "historyId": null,
      "externalPostId": "9876",
      "platform": "instagram",
      "caption": "Il dietro le quinte del lab",
      "mediaUrl": "https://cdn.../img.jpg",
      "publishedAt": "2026-08-05T12:00:00Z",
      "url": "https://www.instagram.com/p/xyz",
      "score": 123.4,
      "metrics": { "likes": 40, "comments": 6, "shares": 3, "saves": 2, "impressions": 3200, "views": 0, "engagementRate": 0.012 },
      "reason": "Engagement rate 1.2% · 46 interactions"
    }
  ],
  "adAccounts": [
    { "id": "uuid", "platform": "metaads", "name": "Conto Ads principale", "currency": "EUR", "status": "active", "zernio_ad_account_id": "acc_1" }
  ]
}
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"Not found"}` — feature ads disabilitata |
| `403` | `{"error":"ads_not_on_plan"}` — piano senza ads |

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/ads?sync=1" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/ads`

Esegue un'azione sulle campagne ads, selezionata dal campo `action` del body.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `action` | string | Sì | `propose` \| `approve` \| `reject` \| `duplicate` \| `delete` \| `pause` \| `resume` \| `toggle` \| `sync` \| `create` |
| `campaignId` | string | per `approve`/`reject`/`duplicate`/`delete`/`pause`/`resume`/`toggle` | ID campagna (`ad_campaigns.id`) |
| `extra` | object | No | Gli altri campi dell'azione, se preferisci raggrupparli invece di metterli in cima al corpo |
| `budgetAmount` | number | No | `approve`: budget giornaliero proposto; `create`: budget |
| `goal` | string | No | `approve`: `engagement` \| `traffic` \| `awareness` \| `video_views`; `create`: default `traffic` |
| `adId` | string | No | Solo `toggle`: se presente agisce sulla singola creativa |
| `next` | string | No | Solo `toggle`: `active` \| `paused` (qualsiasi altro valore = `paused`) |
| `platform` | string | No | Solo `create` — default `metaads` |
| `name` | string | No | Solo `create` — default `"Standalone ad"` |
| `campaignType` | string | No | Solo `create` — `SEARCH` o `DISPLAY` (Google) |
| `adAccountId` | string | No | Solo `create` |
| `keywords` | string[] | No | Solo `create` — targeting Google |
| `headline` / `headlines` | string / string[] | No | Solo `create` — headline (Google) |
| `body` / `descriptions` | string / string[] | No | Solo `create` — testi (Google) |
| `imageUrl` / `squareImageUrl` | string | No | Solo `create` — immagini |
| `businessName` | string | No | Solo `create` |
| `landingPageUrl` | string | No | Solo `create` |

**Response** `200` (varia per action):

```json
{ "ok": true, "created": 3, "candidates": 3 }          // propose
{ "ok": true, "zernioAdId": "12345" }                   // approve
{ "ok": true, "id": "uuid", "copiedCampaignId": "uuid" } // duplicate
{ "ok": true, "next": "paused" }                        // toggle
{ "ok": true, "accounts": 2, "metrics": 1 }             // sync
{ "ok": true, "id": "uuid" }                            // create
```

`reject`/`delete`/`pause`/`resume`: `{"ok": true}`

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"unknown_action"}` |
| `400` | `{"error":"missing_campaignId"}` |
| `400` | `{"error":"<errore dal layer ads>"}` (es. `goal_not_supported:...`) |
| `404` | `{"error":"Not found"}` |
| `403` | `{"error":"ads_not_on_plan"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/ads" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"approve","campaignId":"0f3d...","budgetAmount":15,"goal":"engagement"}'
```

---

## `GET /api/v1/brands/:slug/ads/remix`

Elenco dei remix brief attuali del brand, ordinati per rank.

**Response** `200`:

```json
{
  "briefs": [
    {
      "id": "uuid",
      "sourceAdId": "1012345678",
      "sourcePageName": "Competitor X",
      "sourceBody": "Testo dell'ad sorgente...",
      "sourceThumbnail": "https://.../thumb.jpg",
      "sourceLibraryUrl": "https://www.facebook.com/ads/library/?id=1012345678",
      "rank": 1,
      "strategy": "Riprendi la struttura hook-problema-soluzione...",
      "keep": "La promessa chiara nel primo secondo",
      "change": "Riscrivi in voce del brand, prodotto nostro",
      "hook": "Stufo di risultati che non arrivano?",
      "headline": "Il metodo che funziona davvero",
      "body": "Testo remixato...",
      "cta": "Scopri di più",
      "productName": "Kit Completo",
      "visualPrompt": "Flat lay del kit su sfondo neutro, luce naturale...",
      "status": "proposed"
    }
  ]
}
```

**Errori specifici**: `404` `{"error":"Not found"}` (feature off) · `403` `{"error":"ads_not_on_plan"}`

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/ads/remix" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/ads/remix`

Analizza gli ad dei competitor con la visione AI e sostituisce i remix brief precedenti con una nuova batch classificata (max 5, rank da 1). Se il body include un pool `ads`, salta la raccolta automatica. **Consuma crediti.**

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `ads` | object[] | No | Pool di ad (Ad Library). Campi `NormalizedAd` (es. `adArchiveId`, `pageName`, `body`, `cta`, `linkUrl`, `platforms`, `displayFormat`, `thumbnailUrl`, `startDate`, `isActive`) o `MetaAdDigestItem` (`id`/`adArchiveId`, `title`, `ctaText`, `mediaType`, `imageUrl`, `videoUrl`); serve `id`/`adArchiveId` non vuoto |

**Response** `200`:

```json
{
  "ok": true,
  "briefs": [
    {
      "sourceAdId": "1012345678",
      "sourcePageName": "Competitor X",
      "sourceBody": "Testo sorgente...",
      "sourceThumbnail": "https://.../thumb.jpg",
      "sourceLibraryUrl": "https://www.facebook.com/ads/library/?id=1012345678",
      "rank": 1,
      "strategy": "...",
      "keep": "...",
      "change": "...",
      "hook": "...",
      "headline": "...",
      "body": "...",
      "cta": "...",
      "productName": "Kit Completo",
      "visualPrompt": "...",
      "status": "proposed"
    }
  ]
}
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"no_competitor_ads"}` |
| `400` | `{"error":"no_remix_briefs"}` |
| `400` | `{"error":"<messaggio errore AI>"}` |
| `404` | `{"error":"Not found"}` |
| `403` | `{"error":"ads_not_on_plan"}` |
| `402` | `{"error":"credits_exhausted"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/ads/remix" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ads":[{"adArchiveId":"1012345678","pageName":"Competitor X","body":"...","cta":"Shop Now"}]}'
```

---

## `GET /api/v1/brands/:slug/voice`

Framework di voice del brand: modalità, campi del framework, regole per piattaforma, parole vietate.

**Response** `200`:

```json
{
  "platforms": ["instagram", "linkedin"],
  "voiceMode": "manual",
  "voiceFramework": {
    "mood": "Competente e rassicurante",
    "tone": "Diretto, mai tecnico",
    "register": 3,
    "emotion": "Curiosità",
    "character": "Guida esperta",
    "syntax": "Frasi brevi"
  },
  "platformRules": {},
  "avoid": ["sconti", "urgente"],
  "platformInstructions": {
    "instagram": "Emoji moderate, hashtag 3-5",
    "linkedin": "Tono professionale, no emoji"
  },
  "studioPct": 75
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/voice" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/voice/update`

Aggiorna il framework di voice del brand (sempre in modalità `manual` dopo l'update) e le istruzioni per piattaforma.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `mood` | string | No | Mood |
| `tone` | string | No | Tono |
| `register` | number | No | Registro |
| `emotion` | string | No | Emozione dominante |
| `character` | string | No | Personaggio/ruolo |
| `syntax` | string | No | Sintassi |
| `platform_instructions` | object | No | Mappa `piattaforma → istruzioni`; fa merge con le esistenti |
| `avoid` | string[] | No | Lista parole vietate (sostituisce l'intera lista) |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**: `500` `{"error":"<messaggio Supabase>"}`

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/voice/update" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mood":"Ispirante","avoid":["urgente"],"platform_instructions":{"instagram":"No più di 5 hashtag"}}'
```

---

## `GET /api/v1/brands/:slug/gtm`

Piano GTM attivo, eventuale proposta pendente, stato delle fasi e completezza dello studio.

**Response** `200`:

```json
{
  "gtm": {
    "id": "uuid",
    "status": "active",
    "horizon": "90d",
    "objective": "Lancio del nuovo kit sul mercato DACH",
    "phases": [
      {
        "name": "Teaser",
        "objective": "Generare curiosità pre-lancio",
        "start_date": "2026-08-01",
        "end_date": "2026-08-14",
        "platform_weights": { "instagram": 0.6, "linkedin": 0.4 },
        "pillars": ["Educazione", "Prova sociale"]
      }
    ],
    "parent_id": null,
    "revision_feedback": null,
    "reply": null,
    "changes_summary": null,
    "source": "ai",
    "created_at": "2026-07-20T10:00:00Z",
    "activated_at": "2026-07-21T09:00:00Z"
  },
  "proposed": null,
  "proposedFeedback": null,
  "currentPhase": 0,
  "phaseStatuses": ["now"],
  "horizons": ["90d", "6m", "1y", "2y"],
  "studioPct": 75
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/gtm" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/gtm/update`

Aggiorna l'obiettivo del piano GTM attivo e/o una singola fase (per indice).

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `objective` | string | No | Nuovo obiettivo del piano |
| `phase_index` | number | No | Indice 0-based della fase (ignorato se fuori range) |
| `phase_name` | string | No | Nuovo nome fase (serve `phase_index`) |
| `phase_objective` | string | No | Nuovo obiettivo fase (serve `phase_index`) |
| `platform_weights` | object | No | Pesi per piattaforma (serve `phase_index`) |
| `pillars` | string[] | No | Pilastri della fase (serve `phase_index`) |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"No active GTM plan"}` |
| `400` | `{"error":"No fields to update"}` |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/gtm/update" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"objective":"Nuovo obiettivo","phase_index":0,"phase_name":"Lancio","pillars":["Educazione"]}'
```

---

## `GET /api/v1/brands/:slug/rubrics`

Stato rubriche: set APPROVATO (che guida i planner) e batch PROPOSTA più recente in attesa di revisione.

**Response** `200`:

```json
{
  "ok": true,
  "approved": [
    {
      "id": "uuid",
      "batch_id": "uuid",
      "status": "approved",
      "name": "Dietro le quinte del lab",
      "promise": "Ogni episodio mostra come nasce un nostro prodotto",
      "strategic_role": "consideration: prova concreta del metodo",
      "format": "carousel",
      "cadence": "1/week",
      "differentiation": "Nessun competitor mostra il processo reale",
      "rationale": "Rende concreto il claim di trasparenza",
      "created_at": "2026-07-15T10:00:00Z",
      "approved_at": "2026-07-16T09:00:00Z"
    }
  ],
  "proposed": []
}
```

Note: `format` ∈ `single_image`, `carousel`, `text_post`, `link_post`, `video`.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/rubrics" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/rubrics/propose`

Genera con AI una nuova batch di 5–8 rubriche candidate e sostituisce la batch pendente precedente. **Consuma crediti.**

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `language` | string | No | Lingua di output; default italiano |

**Response** `200`:

```json
{
  "ok": true,
  "proposed": [
    {
      "id": "uuid",
      "batch_id": "uuid",
      "status": "proposed",
      "name": "Mercoledì metodo",
      "promise": "...",
      "strategic_role": "consideration: ...",
      "format": "carousel",
      "cadence": "1/week",
      "differentiation": "...",
      "rationale": "...",
      "created_at": "2026-08-13T10:00:00Z",
      "approved_at": null
    }
  ]
}
```

**Errori specifici**: `500` `{"error":"Propose failed: <messaggio>"}`

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/rubrics/propose" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"language":"Italian"}'
```

---

## `POST /api/v1/brands/:slug/rubrics/approve`

Approva un sottoinsieme della batch proposta: le rubriche selezionate (con eventuali modifiche) diventano il NUOVO set approvato; il precedente è superato; le non selezionate rifiutate.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `picks` | object[] | Sì | Almeno un elemento |
| `picks[].id` | string | Sì | ID della rubrica `proposed` |
| `picks[].edits` | object | No | Modifiche: `name`, `promise`, `strategic_role`, `format`, `cadence`, `differentiation` |

**Response** `200`:

```json
{
  "ok": true,
  "approved": 2,
  "rubrics": [
    {
      "id": "uuid",
      "batch_id": "uuid",
      "status": "approved",
      "name": "Dietro le quinte del lab",
      "promise": "...",
      "strategic_role": "...",
      "format": "carousel",
      "cadence": "1/week",
      "differentiation": "...",
      "rationale": "...",
      "created_at": "2026-08-13T10:00:00Z",
      "approved_at": "2026-08-13T11:00:00Z"
    }
  ]
}
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"picks is required (at least one rubric id)"}` |
| `400` | `{"error":"No proposed rubric matched the given ids"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/rubrics/approve" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"picks":[{"id":"uuid","edits":{"cadence":"2/week"}}]}'
```

---

## `GET /api/v1/brands/:slug/products`

Elenca tutti i prodotti del catalogo (ordinati per data di creazione).

**Response** `200`:

```json
{
  "products": [
    {
      "id": "uuid",
      "title": "Kit Completo",
      "kind": "product",
      "pricing": "€89",
      "imageCount": 3,
      "featured": true
    }
  ]
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/products" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/products`

Ri-sincronizza l'intero catalogo dal sito e-commerce del brand (Shopify / WooCommerce): elimina i prodotti esistenti e reinserisce quelli rilevati. Per aggiungere **una** offerta senza cancellare le altre c'è [`POST /studio/products`](04-studio.md).

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "platform": "Shopify", "synced": 14 }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"No website URL set for this brand."}` |
| `400` | `{"error":"No e-commerce platform detected on the site."}` |
| `400` | `{"error":"No products found on the site."}` |
| `500` | `{"error":"Sync failed: <dettaglio>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/products" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `PUT /api/v1/brands/:slug/products/:id`

Aggiorna i campi di un singolo prodotto. Solo i campi presenti nel body cambiano: le altre colonne restano identiche. Un campo non dichiarato viene **rifiutato**, non ignorato. Tool MCP: `update_product`.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `title` | string | No | Nuovo titolo |
| `description` | string | No | Nuova descrizione |
| `pricing` | string | No | Nuovo prezzo (testo libero) |
| `url` | string | No | Dove sta l'offerta |
| `featured` | boolean | No | Evidenziato sì/no |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"invalid_input","details":[…]}` — campo sconosciuto o tipo sbagliato |
| `400` | `{"error":"no_fields"}` — nessun campo da cambiare |
| `404` | `{"error":"not_found"}` — l'id non esiste **o** è di un altro brand: la risposta è la stessa |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X PUT "https://anomalia.so/api/v1/brands/mio-brand/products/PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"featured":true,"pricing":"€99"}'
```

---

## `DELETE /api/v1/brands/:slug/products/:id`

Elimina un prodotto del brand. Tool MCP: `delete_product`.

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"not_found"}` — l'id non esiste **o** è di un altro brand |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X DELETE "https://anomalia.so/api/v1/brands/mio-brand/products/PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/api-keys`

Elenca le API key dell'utente che hanno accesso a questo brand (mai le chiavi raw).

**Response** `200`:

```json
{
  "keys": [
    {
      "id": "uuid",
      "name": "CI deploy",
      "key_prefix": "anomalia_live_a1",
      "permissions": { "brand_ids": ["BRAND_ID"], "scopes": ["read", "write"] },
      "created_at": "2026-06-01T10:00:00Z",
      "last_used_at": "2026-08-12T09:00:00Z"
    }
  ]
}
```

**Errori specifici**

| Status | Body |
|---|---|
| `403` | `{"error":"API key does not have access to this brand"}` |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/api-keys" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/api-keys`

Crea una nuova API key. Richiede JWT (le API key non possono crearne altre). La chiave raw viene restituita **una sola volta**.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `name` | string | No | Default `"API Key"` |
| `scopes` | string[] | No | Default `["read"]`; valori validi `read`/`write` (invalidi scartati, `read` sempre forzato) |
| `all_brands` | boolean | No | Se `true`, key per tutti i brand (`brand_ids: "*"`); default: solo questo brand |

**Response** `201`:

```json
{
  "key": {
    "id": "uuid",
    "name": "CI deploy",
    "key_prefix": "anomalia_live_a1",
    "permissions": { "brand_ids": ["BRAND_ID"], "scopes": ["read", "write"] },
    "created_at": "2026-08-13T10:00:00Z",
    "raw": "anomalia_live_<48 hex>"
  },
  "message": "Copy this key now — you will not be able to see it again."
}
```

**Errori specifici**

| Status | Body |
|---|---|
| `403` | `{"error":"API keys cannot create API keys — sign in with the CLI"}` |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/api-keys" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"CI deploy","scopes":["read","write"]}'
```

---

## `DELETE /api/v1/brands/:slug/api-keys/:id`

Revoca una API key. La key deve appartenere all'utente autenticato ed essere scopedata su questo brand.

**Response** `200`:

```json
{ "deleted": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"API key not found"}` |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X DELETE "https://anomalia.so/api/v1/brands/mio-brand/api-keys/KEY_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/ideas`

Tool MCP: `list_ideas`.

Il banco delle idee dirompenti del brand — quello che gli agenti salvano mentre lavorano
(`save_disruptive_idea`). Nessuna chiamata AI: lettura pura.

**Query**

| Param | Default | Note |
|---|---|---|
| `status` | *(vive)* | `new` · `shortlisted` · `used` · `archived` · `all`. Omesso = solo `new` + `shortlisted` |
| `limit` | `50` | max 200 |

**Response** `200`:

```json
{
  "count": 1,
  "ideas": [
    {
      "id": "…",
      "title": "La maglia che brucia",
      "idea": "Qualcuno brucia una maglia ultra low-cost, marchio mai inquadrato…",
      "device": "destroy_the_alternative",
      "why_it_contrasts": "Nessuno mostra la fine del prodotto che vende",
      "who_it_annoys": "Chi vende fast fashion",
      "format": "comparison",
      "score": 88,
      "status": "new",
      "surface": "ugc",
      "created_at": "2026-08-20T10:00:00Z"
    }
  ]
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/ideas?status=all&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/ideas`

Due usi, distinti dalla presenza di `id`:

- **Nuova idea** — `title` e `idea` obbligatori; opzionali `device` (una delle dodici leve di
  `src/lib/disruptive.ts`), `why_it_contrasts`, `who_it_annoys`, `format`, `score` (0-100).
  Ri-inviare lo stesso `title` **aggiorna** la riga invece di duplicarla (`duplicate: true`).
- **Cambio di stato** — `id` + `status` (`new` · `shortlisted` · `used` · `archived`).

Richiede una key con scope `write`.

**Response** `200`: `{ "ok": true, "idea": { … }, "duplicate": false }`

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"title and idea are required"}` |
| `400` | `{"error":"status must be new \| shortlisted \| used \| archived"}` |
| `403` | `{"error":"API key is read-only"}` |
| `404` | `{"error":"Idea not found"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/ideas" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"La maglia che brucia","idea":"Brucia una maglia low-cost, marchio mai inquadrato","device":"destroy_the_alternative","who_it_annoys":"Chi vende fast fashion"}'
```

---

## `GET /api/v1/brands/:slug/market/field`

Tool MCP: `get_market_field`.

Cosa si muove nel **campo** del brand: i topic osservati, il playbook distillato da quello che
gira, e i post catalogati con il loro teardown — perché quel post ha girato, e cosa se ne può
portare via. Lettura pura: nessuna chiamata AI, nessun credito. La passata che riempie queste
tabelle è il `POST` sotto, di norma fatto dal cron.

**Query**

| Param | Default | Note |
|---|---|---|
| `limit` | `20` | quanti post del campo, max 50 |

**Response** `200`:

```json
{
  "topics": { "queries": ["crm per agenzie"], "hashtags": ["#agencylife"] },
  "playbook": {
    "summary": "Il campo apre con un costo e chiude con un invito a dissentire",
    "hooks": [{ "pattern": "numero + categoria", "example": "3 cose che le agenzie sbagliano" }],
    "tones": ["esperto seccato"],
    "fieldRagebait": 4,
    "moves": [{ "move": "chiama la categoria per nome", "why": "…", "howToAdapt": "…", "ragebait": 3 }],
    "avoid": ["callout con nome"],
    "postsSeen": 42,
    "updatedAt": "2026-09-01T08:00:00Z"
  },
  "updatedAt": "2026-09-01T08:00:00Z",
  "posts": [
    {
      "id": "…",
      "platform": "threads",
      "url": "https://www.threads.net/@tizio/post/…",
      "account_key": "threads:tizio",
      "content": "…",
      "media_type": "text",
      "engagement": 1820,
      "published_at": "2026-08-30T18:00:00Z",
      "query": "crm per agenzie",
      "relevance": 0.72,
      "discoveredAt": "2026-08-31T04:00:00Z",
      "teardown": {
        "market_post_id": "…",
        "tone_of_voice": "amico che ti avverte",
        "communication": "prima persona, frasi corte",
        "format": "lista numerata",
        "hook_type": "promessa di un errore da evitare",
        "spread_strategy": ["chiama in causa una categoria per nome"],
        "ragebait": 4,
        "ragebait_levers": ["hot take contro il consenso"],
        "why_it_spread": "dice ad alta voce una cosa che tutti pensano",
        "transferable": ["aprire con il costo reale"],
        "avoid": null
      }
    }
  ]
}
```

Un campo mai osservato risponde `200` con `topics`, `playbook` e `updatedAt` a `null` e `posts`
vuoto: è uno stato, non un errore. `teardown` è `null` finché il post non è stato smontato.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/market/field?limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/radar/diagnose`

Tool MCP: `diagnose_radar`.

L'autodiagnosi delle fonti Radar: **interroga ogni sorgente configurata dal vivo** e dice, per
ognuna, quanti item sono tornati o perché è stata saltata — spenta, esclusa dal piano, piattaforma
disattivata in Settings, o endpoint in errore. È la risposta a «perché il Radar non trova niente».

Nessuna chiamata AI, nessun credito, nessuna scrittura, niente in coda. Ma esce di casa: fa una
richiesta di rete per fonte, quindi può metterci secondi (`maxDuration` 300). Le ricerche
dinamiche per keyword non vengono sondate qui — costano un credito di scraping ciascuna e sono
già registrate per scansione in `radar_searches`.

**Query params**: nessuno

**Response** `200`:

```json
{
  "enabled": true,
  "plan": "pro",
  "proLeads": true,
  "scrapecreatorsConfigured": true,
  "platforms": { "reddit": true, "threads": true, "x": false },
  "engagePlatforms": ["reddit", "threads", "x", "linkedin"],
  "sources": [
    {
      "kind": "rss",
      "value": "https://esempio.it/feed",
      "active": true,
      "allowedByPlan": true,
      "enabled": true,
      "platform": null,
      "items": 12,
      "windowHours": 48,
      "sample": [{ "title": "…", "url": "https://esempio.it/articolo" }]
    },
    {
      "kind": "reddit",
      "value": "r/agency",
      "active": false,
      "allowedByPlan": true,
      "enabled": true,
      "platform": "reddit",
      "items": 0,
      "skipped": "source is off"
    },
    {
      "kind": "rss",
      "value": "https://rotto.it/feed",
      "active": true,
      "allowedByPlan": true,
      "enabled": true,
      "platform": null,
      "items": 0,
      "error": "HTTP 503"
    }
  ],
  "note": "Dynamic keyword searches are reported per scan in radar_searches, not probed here."
}
```

Una fonte porta sempre `items`; `skipped` ed `error` si escludono a vicenda e spiegano lo zero.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/radar/diagnose" \
  -H "Authorization: Bearer $TOKEN"
```
