# API — 06 · Weekly plan

Pianificazione settimanale: seeds, produzione post, batch render, salvataggio bozza.
Errori comuni di auth: vedi [01-overview](01-overview.md). plan/produce/render consumano crediti.

## `GET /api/v1/brands/:slug/weekly-plan`

Stato del piano settimanale: settimane del piano editoriale attivo, settimana corrente, ultimi post, bozza corrente (`content_plans` in stato `draft`) e quota utilizzo.

**Query params**: nessuno

**Response** `200`:

```json
{
  "plan": {
    "cadence": "weekly",
    "weeks": [
      { "index": 0, "theme": "Lancio estivo", "status": "planned" },
      { "index": 1, "theme": "Social proof", "status": "planned" }
    ],
    "platform_mix": [{ "platform": "instagram", "percent": 80 }],
    "strategy": "…strategia del piano editoriale attivo…"
  },
  "currentWeekIdx": 0,
  "posts": [
    {
      "id": "a1b2c3d4-…",
      "platform": "instagram",
      "caption": "…caption del post…",
      "status": "pending_user",
      "slot": "2026-08-13T10:00:00",
      "scheduled_for": null,
      "pillar": "CTA verso sito",
      "format": "single_image"
    }
  ],
  "seeds": {
    "id": "e5f6a7b8-…",
    "seeds": {
      "theme": "…tema settimanale generato dall'AI…",
      "rationale": "…",
      "doDont": "…guardrail per il copywriter…",
      "seeds": [
        {
          "platform": "instagram",
          "platforms": ["instagram"],
          "pillar": "CTA verso sito",
          "format": "single_image",
          "media": "image",
          "day": "Lunedì",
          "time": "10:00",
          "product": "Nome Prodotto",
          "person": "",
          "angle": "…hook di questo post…",
          "subject": "…",
          "setting": "…",
          "props": "…"
        }
      ]
    },
    "editorial_week": 0
  },
  "quota": { "used": 5, "max": 12 }
}
```

Note: i seed hanno campi variabili per formato (es. `slide_count` per carousel, `hook`/`body`/`cta`/`ugc` per video, `title`/`link_url`/`subreddit` per Reddit). `quota.max` è 30 per piano `pro`, altrimenti 12. `plan` e `seeds` possono essere `null`.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/weekly-plan" -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/weekly-plan/plan`

Genera la strategia settimanale (tema + seed per post) per la settimana `week_index` e la salva come bozza in `content_plans` (status `draft`). Non spende render immagini. **Consuma crediti.**

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `week_index` | number (0-based) | Sì | Indice della settimana del piano editoriale attivo |

**Response** `200`:

```json
{
  "ok": true,
  "draft": {
    "theme": "…tema settimanale generato dall'AI…",
    "rationale": "…",
    "doDont": "…do/don't per il copywriter…",
    "seeds": [
      {
        "id": "seed-…",
        "platform": "instagram",
        "platforms": ["instagram"],
        "pillar": "CTA verso sito",
        "format": "single_image",
        "media": "image",
        "day": "Lunedì",
        "time": "10:00",
        "product": "Nome Prodotto",
        "person": "",
        "angle": "…",
        "subject": "…",
        "setting": "…",
        "props": "…"
      }
    ]
  }
}
```

Note: il draft viene salvato con `title: "CLI · YYYY-MM-DD"` e `editorial_week = week_index`; `rubric`/`rubric_id` presenti se il brand ha rubriche approvate.

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"week_index is required"}` |
| `500` | `{"error":"<messaggio errore Supabase>"}` |
| `500` | `{"error":"Plan failed: <errore>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/weekly-plan/plan" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"week_index":0}'
```

---

## `POST /api/v1/brands/:slug/weekly-plan/produce`

Trasforma i seed di una bozza in post reali (caption + prompt immagine via AI), li inserisce in `posts` con status `pending_user` e marca la bozza come `produced`. **Consuma crediti.**

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `draft_id` | string (UUID) | Sì | ID della bozza in `content_plans` |
| `row_index` | number | No | Se presente, produce solo il seed in quella posizione |

**Response** `200`:

```json
{ "ok": true, "produced": 3 }
```

**Errori specifici**

| Status | Body |
|---|---|
| `402` | `{"error":"credits_exhausted"}` |
| `400` | `{"error":"draft_id is required"}` |
| `422` | `{"error":"growth_data_incomplete","message":"…","checks":[…],"ready":false}` |
| `404` | `{"error":"Draft not found"}` |
| `400` | `{"error":"No seeds to produce"}` |
| `500` | `{"error":"Produce failed: <errore>"}` |

**Esempi**:

```bash
# Produce l'intera settimana
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/weekly-plan/produce" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"draft_id":"e5f6a7b8-…"}'

# Produce una sola riga (seed index 2)
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/weekly-plan/produce" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"draft_id":"e5f6a7b8-…","row_index":2}'
```

---

## `POST /api/v1/brands/:slug/weekly-plan/render`

Renderizza in batch le immagini di tutti i post `pending_user` senza immagine. Se `week_index` è assente, processa tutti i post pending del brand. **Consuma crediti.**

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `week_index` | number | No | Filtra i post per `plan_id` delle bozze con `editorial_week = week_index`. Assente → tutti i pending |

**Response** `200`:

```json
{
  "ok": true,
  "rendered": 2,
  "failed": 1,
  "results": [
    {
      "id": "a1b2c3d4-…",
      "ok": true,
      "url": "https://…/storage/…/immagine.webp",
      "qc": { "score": 92, "pass": true, "issues": [], "retried": false },
      "product": "Nome Prodotto"
    },
    {
      "id": "b2c3d4e5-…",
      "ok": false,
      "error": "…motivo del fallimento…",
      "qc": { "score": 40, "pass": false, "issues": ["…"], "retried": true },
      "product": ""
    }
  ]
}
```

Nessun post renderizzabile:

```json
{ "ok": true, "rendered": 0, "failed": 0, "results": [] }
```

**Errori specifici**: `500` `{"error":"Batch render failed: <errore>"}`

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/weekly-plan/render" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"week_index":0}'
```

---

## `POST /api/v1/brands/:slug/weekly-plan/save`

Sovrascrive l'intero oggetto `seeds` di una bozza `content_plans` (tipicamente il `WeeklyStrategy` aggiornato).

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `draft_id` | string (UUID) | Sì | ID della bozza da aggiornare |
| `seeds` | object | Sì | Nuovo valore della colonna `seeds`: oggetto `WeeklyStrategy` completo o array di seed |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `403` | `{"error":"API key is read-only"}` |
| `400` | `{"error":"draft_id is required"}` |
| `500` | `{"error":"<messaggio errore Supabase>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/weekly-plan/save" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"draft_id":"e5f6a7b8-…","seeds":{"theme":"…","rationale":"…","doDont":"…","seeds":[{"platform":"instagram","platforms":["instagram"],"pillar":"CTA verso sito","format":"single_image","media":"image","day":"Lunedì","time":"10:00","product":"Nome Prodotto","person":"","angle":"…","subject":"…","setting":"…","props":"…"}]}}'
```
