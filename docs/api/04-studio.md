# API — 04 · Studio

Studio del brand: kit, colori, memoria, persone, documenti, competitor, storico.
Errori comuni di auth: vedi [01-overview](01-overview.md).

## `GET /api/v1/brands/:slug/studio`

Dump completo dello studio: kit, prodotti, documenti, storico social, persone, competitor, piattaforme target, istruzioni per piattaforma, lingua e percentuale di completezza.

**Response** `200`:

```json
{
  "kit": {
    "category": "Caffè specialty",
    "about": "Torrefazione artigianale a Milano",
    "brand_style": "Minimal, caldo, autentico",
    "target_audience": "Giovani professionisti urbani",
    "brand_colors": ["#7c5cff", "#ffffff"],
    "theme_color": null,
    "favicon_url": null,
    "fonts": null,
    "logos": null,
    "ai_character": "Barista esperto e ironico",
    "ai_context": "…contesto AI generato…",
    "ai_context_updated_at": "2026-08-13T08:00:00.000Z",
    "visual_style": null,
    "visual_style_locked": false,
    "content_pillars": null,
    "site_type": null,
    "images": null
  },
  "products": [
    { "id": "ID", "title": "Blend Milano", "pricing": { "amount": 18.5, "currency": "EUR" }, "images": [], "featured": true }
  ],
  "documents": [
    { "id": "ID", "kind": "note", "title": "Note", "content_text": "…", "file_url": null, "file_name": null, "mime_type": null, "created_at": "2026-08-01T10:00:00.000Z" }
  ],
  "history": [
    { "id": "ID", "platform": "instagram", "content": "…", "thumbnail_url": "https://…", "platform_post_url": "https://…", "metrics": { "likes": 120 }, "published_at": "2026-08-10T12:00:00.000Z" }
  ],
  "people": [
    { "id": "ID", "name": "Giulia", "role": "Fondatrice", "kind": "ai", "description": "…", "consent": true, "imageCount": 2 }
  ],
  "competitors": [
    { "id": "ID", "name": "Caffè Rivale", "website": "https://cafferivale.it", "kind": "direct", "rationale": "…", "source": "ai", "created_at": "2026-08-11T09:00:00.000Z" }
  ],
  "targetPlatforms": ["instagram", "tiktok"],
  "platformInstructions": { "instagram": "…" },
  "language": "it",
  "studioPct": 62
}
```

Note: `kit` può essere `null`; `studioPct` = % di 8 controlli di completezza superati; storico limitato a 60 post.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/studio" -H "Authorization: Bearer $TOKEN"
```

---

## `PUT /api/v1/brands/:slug/studio/kit`

Aggiorna i campi del brand kit (`about`, `category`, `target_audience`, `brand_style`) e la lingua in `content_prefs`. I campi omessi vengono azzerati (`null`), non preservati.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `about` | string | no | Descrizione del brand (omesso → `null`) |
| `category` | string | no | Categoria (omessa → `null`) |
| `target_audience` | string | no | Pubblico target (omesso → `null`) |
| `brand_style` | string | no | Stile (omesso → `null`) |
| `language` | string | no | Lingua in `content_prefs.language`; se omessa non viene toccata |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**: `500` `{"error":"<messaggio Supabase>"}` se l'upsert fallisce.

**Esempio**:

```bash
curl -s -X PUT "https://anomalia.so/api/v1/brands/mio-brand/studio/kit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"about":"Torrefazione artigianale a Milano","category":"Caffè","target_audience":"Giovani professionisti","brand_style":"Minimal e caldo","language":"it"}'
```

---

## `PUT /api/v1/brands/:slug/studio/colors`

Imposta i colori del brand (max 8 hex), salvati in `brand_kit.brand_colors`.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `colors` | string[] | sì | Array di 1–8 colori hex (`#rgb` o `#rrggbb`); il `#` iniziale può mancare |

**Response** `200`:

```json
{ "ok": true, "colors": ["#7c5cff", "#ffffff"] }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"colors must be an array of max 8 hex strings"}` |
| `400` | `{"error":"Invalid color: <colore>"}` |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X PUT "https://anomalia.so/api/v1/brands/mio-brand/studio/colors" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"colors": ["#7c5cff", "#ffffff"]}'
```

---

## `GET /api/v1/brands/:slug/studio/memory`

Elenca le voci di memoria del brand (`brand_memory`). Di default esclude le voci di layer `session`, ordinate per `confidence` decrescente.

**Query params**

| Param | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `category` | string | No | `voice` \| `constraint` \| `fact` \| `preference` \| `insight` |
| `source` | string | No | `chat` \| `research` \| `onboarding` \| `user` \| `analysis` |
| `thread_id` | string | No | Restringe a layer `session` e al thread indicato |
| `layer` | string | No | Solo `session` ha effetto (tutte le sessioni) |

**Response** `200`:

```json
{
  "entries": [
    {
      "id": "ID",
      "brand_id": "BRAND_ID",
      "layer": "project",
      "category": "fact",
      "key": "orario apertura",
      "value": "Il locale apre alle 8:00",
      "source": "user",
      "confidence": 1.0,
      "times_reinforced": 0,
      "times_used": 12,
      "last_reinforced_at": "2026-08-13T08:00:00.000Z",
      "last_used_at": "2026-08-13T09:00:00.000Z",
      "expires_at": null,
      "created_at": "2026-08-01T10:00:00.000Z",
      "updated_at": "2026-08-13T08:00:00.000Z",
      "pinned": false,
      "importance": 3,
      "thread_id": null,
      "promoted_at": null,
      "promoted_by": null
    }
  ]
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/studio/memory?category=fact" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/studio/memory`

Scrive una voce di memoria con `source: 'user'` e `confidence: 1.0`. Se la `key` esiste già (fuori dalle sessioni), la voce viene rinforzata (confidence +0.05, `times_reinforced` +1) invece di duplicata.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `key` | string | sì | Chiave della voce |
| `value` | string | sì | Contenuto |
| `category` | string | sì | `voice` \| `constraint` \| `fact` \| `preference` \| `insight` |

**Response** `200`:

```json
{ "ok": true, "id": "ID", "reinforced": false }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"key, value, and category are required"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/studio/memory" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"orario apertura","value":"Il locale apre alle 8:00","category":"fact"}'
```

---

## `DELETE /api/v1/brands/:slug/studio/memory`

Elimina una voce di memoria passando l'id nel body (non nel path).

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `id` | string | sì | Id della voce da eliminare |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**: `400` `{"error":"id is required"}`

**Esempio**:

```bash
curl -s -X DELETE "https://anomalia.so/api/v1/brands/mio-brand/studio/memory" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"ID"}'
```

---

## `PATCH /api/v1/brands/:slug/studio/memory/:id`

Aggiorna una singola voce di memoria; il body viene passato direttamente come patch.

**Body** (tutti opzionali)

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `value` | string | no | Nuovo contenuto |
| `category` | string | no | Nuova categoria |
| `confidence` | number | no | 0–1 |
| `pinned` | boolean | no | Fissata in cima al contesto |
| `importance` | number | no | 1–5 |

**Response** `200`:

```json
{ "ok": true }
```

**Esempio**:

```bash
curl -s -X PATCH "https://anomalia.so/api/v1/brands/mio-brand/studio/memory/ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pinned":true,"importance":5}'
```

---

## `POST /api/v1/brands/:slug/studio/memory/:id`

Promuove una memoria di sessione a conoscenza di brand (layer `project`). Se esiste già una voce project con la stessa `key`, la fonde e cancella la riga di sessione.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `action` | string | sì | Deve essere `"promote"` |

**Response** `200`:

```json
{ "ok": true, "id": "ID", "merged": false }
```

**Errori specifici**: `400` `{"error":"Unsupported action"}` se `action` non è `promote`.

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/studio/memory/ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"promote"}'
```

---

## `DELETE /api/v1/brands/:slug/studio/memory/:id`

Elimina una voce di memoria per id nel path.

**Response** `200`:

```json
{ "ok": true }
```

**Esempio**:

```bash
curl -s -X DELETE "https://anomalia.so/api/v1/brands/mio-brand/studio/memory/ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/studio/people`

Aggiunge una persona allo studio: reale (`kind` omesso) o AI (`kind: 'ai'`, genera 1–3 ritratti fotorealistici via Gemini, salvati come data URL base64 in `images`).

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `name` | string | sì | Nome |
| `role` | string | no | Ruolo |
| `description` | string | no | Descrizione |
| `kind` | string | no | `ai` per generare i ritratti, altrimenti `real` |
| `consent` | boolean | sì se `real` | Attestazione di chi chiama: `true` solo se hai il consenso di quella persona all'uso della sua immagine. Registrata con timestamp e provenienza (`owner_attested`); una persona AI non la richiede (`ai_generated`) |
| `gender` | string | no | Genere (usato dal generatore) |
| `ageRange` | string | no | Fascia d'età |
| `ethnicity` | string | no | Etnia |
| `vibe` | string | no | Stile/atmosfera |

**Response** `200`:

```json
{ "ok": true, "person": { "id": "ID", "name": "Giulia", "role": "Fondatrice", "kind": "ai" } }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"name is required"}` |
| `400` | `{"error":"Confirm you have this person’s consent before adding them."}` — persona reale senza `consent: true`. Finché il consenso non è registrato quel volto resta escluso da ogni generatore |
| `500` | `{"error":"AI generation failed: <dettaglio>"}` |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/studio/people" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Giulia","role":"Fondatrice","kind":"ai","gender":"female","ageRange":"30s","vibe":"professionale e solare"}'
```

---

## `DELETE /api/v1/brands/:slug/studio/people/:id`

Elimina una persona dello studio e rimuove le sue immagini dallo storage (best-effort).

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"Person not found"}` |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X DELETE "https://anomalia.so/api/v1/brands/mio-brand/studio/people/ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/studio/products`

Aggiunge **una** offerta al catalogo. Deterministico: nessun modello, nessun credito. Non è la stessa cosa di [`POST /products`](08-ads-voice-gtm-misc.md), che risincronizza l'intero catalogo da Shopify o WooCommerce cancellando prima tutto — un prodotto scritto a mano non sopravvivrebbe. Tool MCP: `create_product`.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `title` | string | sì | Come si chiama l'offerta |
| `description` | string | no | Cos'è, con le parole del brand |
| `pricing` | string | no | Testo libero come lo scrive il brand: `"18,50 €"`, `"Free"` |
| `url` | string | no | Dove sta l'offerta |
| `kind` | string | no | Categoria di catalogo (default `product`) |
| `featured` | boolean | no | Se il planner può metterla in primo piano (default `true`) |

I campi non passati non vengono scritti: restano i default del database.

**Response** `200`:

```json
{ "ok": true, "product": { "id": "ID", "title": "Blend Milano", "kind": "product", "pricing": "18,50 €", "featured": true } }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"invalid_input","details":[…]}` — titolo mancante o campo non dichiarato |
| `500` | `{"error":"insert_failed","details":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/studio/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Blend Milano","pricing":"18,50 €","description":"Arabica lavata, tostatura chiara"}'
```

---

## `POST /api/v1/brands/:slug/studio/documents`

Aggiunge un documento/conoscenza (`brand_documents`) e ricostruisce il contesto AI (best-effort).

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `title` | string | no | Titolo (default `"Note"`) |
| `content_text` | string | condizionale | Obbligatorio a meno che `kind` sia `document`. Accettato anche come `text` |
| `kind` | string | no | Default `note`; `document` permette testo vuoto |

**Response** `200`:

```json
{ "ok": true, "document": { "id": "ID", "kind": "note", "title": "Note" } }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"content_text is required"}` |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/studio/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Linee guida packaging","content_text":"Utilizzare carta riciclata e inchiostri a base d'\''acqua."}'
```

---

## `DELETE /api/v1/brands/:slug/studio/documents/:id`

Elimina un documento: rimuove il file dallo storage (best-effort), cancella la riga, ricostruisce il contesto AI (best-effort).

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"Document not found"}` |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X DELETE "https://anomalia.so/api/v1/brands/mio-brand/studio/documents/ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/studio/competitors`

Aggiunge manualmente un competitor (`source: 'user'`). Il sito viene normalizzato con prefisso `https://` se manca.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `name` | string | sì | Nome |
| `website` | string | no | Sito (senza protocollo → prefisso `https://`) |
| `kind` | string | no | `direct` (default) \| `indirect` |
| `rationale` | string | no | Motivo della competizione |

**Response** `200`:

```json
{ "ok": true, "competitor": { "id": "ID", "name": "Caffè Rivale", "website": "https://cafferivale.it", "kind": "direct", "source": "user" } }
```

**Errori specifici**: `400` `{"error":"name is required"}` · `500` `{"error":"<messaggio Supabase>"}`

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/studio/competitors" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Caffè Rivale","website":"cafferivale.it","kind":"direct","rationale":"Stessa fascia di prezzo"}'
```

---

## `PUT /api/v1/brands/:slug/studio/competitors/:id`

Aggiorna un competitor; solo i campi presenti nel body vengono modificati, gli altri restano identici. `website` normalizzato con `https://`. Un campo non dichiarato viene **rifiutato**, non ignorato. Tool MCP: `update_competitor`.

**Body** (tutti opzionali, almeno uno)

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `name` | string | no | Nuovo nome |
| `website` | string | no | Nuovo sito |
| `kind` | string | no | `direct` \| `indirect` — gli unici due che il CHECK del database accetta |
| `rationale` | string | no | Nuovo rationale |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"invalid_input","details":[…]}` |
| `400` | `{"error":"no_fields"}` |
| `404` | `{"error":"not_found"}` — l'id non esiste **o** è di un altro brand: la risposta è la stessa |

**Esempio**:

```bash
curl -s -X PUT "https://anomalia.so/api/v1/brands/mio-brand/studio/competitors/ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"indirect","rationale":"Risolve lo stesso bisogno con una tazzina diversa"}'
```

---

## `DELETE /api/v1/brands/:slug/studio/competitors/:id`

Elimina un competitor.

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**: `404` `{"error":"not_found"}` — l'id non esiste **o** è di un altro brand.

**Esempio**:

```bash
curl -s -X DELETE "https://anomalia.so/api/v1/brands/mio-brand/studio/competitors/ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/studio/competitors/research`

Ricerca AI dei competitor reali (3–5, direct + indirect) via web search Gemini, con dedup per nome/dominio, inseriti con `source: 'ai'`. **Consuma crediti** (`gateAiAction`).

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "found": 4, "added": 3 }
```

**Errori specifici**

| Status | Body |
|---|---|
| `500` | `{"error":"Research failed: <dettaglio>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/studio/competitors/research" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/studio/history/sync`

Sincronizza lo storico dei post social (`social_post_history`) dai profili dichiarati del brand. Cache di 7 giorni; ricostruisce il contesto brand se vengono sincronizzati post.

**Body**: nessuno

**Response** `200`:

```json
{ "synced": 12, "accounts": 2, "errors": [] }
```

Note: `errors` = array di `{ "platform": "instagram", "message": "…" }` per profilo fallito.

**Errori specifici**: `500` `{"error":"Sync failed: <dettaglio>"}`

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/studio/history/sync" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `PUT /api/v1/brands/:slug/people/:id`

Aggiorna una persona (percorso top-level, non sotto `/studio`). Solo i campi presenti vengono modificati, gli altri restano identici. Tool MCP: `update_person`.

`consent`, `consent_source`, `kind` e `images` **non** sono modificabili qui e una richiesta che li nomina viene rifiutata: il consenso lo attesta una persona, non una modifica. Finché non è attestato, `resolvePeopleVisualRefs` nega quel volto a ogni generatore.

**Body** (almeno uno obbligatorio)

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `name` | string | no | Nuovo nome |
| `role` | string | no | Nuovo ruolo |
| `description` | string | no | Nuova descrizione |
| `attributes` | object | no | Nuovi attributi, valori stringa (es. `{"gender":"female"}`) |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"invalid_input","details":[…]}` — campo non dichiarato o tipo sbagliato |
| `400` | `{"error":"no_fields"}` |
| `404` | `{"error":"not_found"}` — l'id non esiste **o** è di un altro brand: la risposta è la stessa |
| `500` | `{"error":"<messaggio Supabase>"}` |

**Esempio**:

```bash
curl -s -X PUT "https://anomalia.so/api/v1/brands/mio-brand/people/ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"Co-fondatrice","attributes":{"gender":"female"}}'
```
