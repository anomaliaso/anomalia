# API — 03 · Posts

Ciclo di vita dei post: lista, modifica, approvazione, pubblicazione, reschedule, render, media, revoke.
Errori comuni di auth: vedi [01-overview](01-overview.md).

## `GET /api/v1/brands/:slug/posts`

Elenca i post del brand (max 50, ordinati per `created_at` decrescente), con filtro opzionale per status.

**Query params**

| Param | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `status` | string | No | `pending_user` \| `approved` \| `scheduled` \| `published` \| `failed`. Omesso o `all` → nessun filtro |

**Response** `200`:

```json
[
  {
    "id": "a1b2c3d4-…",
    "brand_id": "e5f6a7b8-…",
    "platform": "instagram",
    "platforms": ["instagram", "facebook"],
    "caption": "…",
    "image_prompt": "…",
    "slot": "Mon 09:00",
    "media_url": "https://…/media/….png",
    "status": "pending_user",
    "content_type": "generated_image",
    "scheduled_for": "2026-08-14T07:00:00.000Z",
    "published_url": null,
    "product_name": "…",
    "revisions_count": 0,
    "pillar": "…",
    "format": "single_image",
    "created_at": "2026-08-13T10:00:00.000Z"
  }
]
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/posts?status=pending_user" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/posts`

Salva una copy già scritta come **un post `pending_user`**, pronto per la revisione.

Non chiama nessun modello e **non consuma crediti**: niente `gateAiAction`. Non pubblica e non
programma niente — `scheduled_for` è la data **proposta**, e resta un metadato del calendario
finché il post non viene approvato. È `POST /posts/:id/approve` ad autorizzare la distribuzione.

Senza media valgono solo le piattaforme che reggono il testo da solo: `facebook`, `linkedin`, `x`,
`threads`, `bluesky`, `reddit`. Con `media_ids` si sbloccano anche `instagram` e `tiktok`, e
`youtube` se il media è un video.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `platforms` | string[] | Sì | Almeno una. Le sconosciute vengono scartate → `no_platforms` |
| `caption` | string | Sì | La copy, salvata così com'è |
| `platform_captions` | object | No | Override per piattaforma, `{"x": "…"}` |
| `scheduled_for` | string | No | Istante proposto, ISO. Senza offset è letto sul fuso del brand; con `Z` o `±hh:mm` è preso come scritto. Almeno 2 minuti nel futuro |
| `media_ids` | string[] | No | Fino a 8 id dalla libreria del brand (`GET /media`). Un id che non è di questo brand fa fallire la creazione: il post non nasce mai senza |
| `title` | string | No | Obbligatorio per Reddit (max 300 char) |
| `subreddit` | string | No | Senza `r/` |
| `link_url` | string | No | |

**Response** `200`:

```json
{
  "ok": true,
  "id": "a1b2c3d4-…",
  "status": "pending_user",
  "scheduled_for": "2030-05-16T07:00:00.000Z",
  "scheduled_for_local": "2030-05-16 09:00 (Europe/Rome)",
  "slot": "Thu 09:00",
  "review_url": "https://anomalia.so/app/mio-brand/posts/a1b2c3d4-…"
}
```

Senza `scheduled_for`, i campi `scheduled_for`, `scheduled_for_local` e `slot` sono `null`: il
post resta una bozza senza data, fuori dal calendario ma elencata da `GET /posts`.

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"invalid_input","details":[…]}` — body fuori schema |
| `400` | `{"error":"no_platforms"}` — nessuna piattaforma riconosciuta |
| `400` | `{"error":"need_caption"}` |
| `400` | `{"error":"need_media"}` — piattaforma che non regge il solo testo |
| `400` | `{"error":"need_video"}` |
| `400` | `{"error":"over_limit"}` — copy oltre il limite della piattaforma |
| `400` | `{"error":"reddit_title"}` |
| `400` | `{"error":"invalid_scheduled_for","details":"…"}` — data illeggibile |
| `400` | `{"error":"too_soon"}` — data passata o troppo vicina |
| `400` | `{"error":"media_not_found"}` — un id media non è di questo brand, o non si è potuto copiare |
| `403` | `{"error":"API key is read-only"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "platforms": ["linkedin","x"],
    "caption": "Tre cose che abbiamo imparato spedendo di venerdì.",
    "scheduled_for": "2030-05-16T09:00"
  }'
```

---

## `DELETE /api/v1/brands/:slug/posts`

Elimina in blocco i post di uno status (default `pending_user`). Rifiuta `published`.

**Query params**

| Param | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `status` | string | No | Default `pending_user`. `published` → 400 |

**Response** `200`:

```json
{ "ok": true, "deleted": 3 }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"Refusing to bulk-delete published posts."}` |
| `500` | `{"error":"<messaggio errore DB>"}` |

**Esempio**:

```bash
curl -s -X DELETE "https://anomalia.so/api/v1/brands/mio-brand/posts?status=pending_user" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `PUT /api/v1/brands/:slug/posts/:id`

Aggiorna i campi editabili di un post senza re-render. Se il post è già programmato su Zernio, la modifica viene ri-sincronizzata.

**Body** (tutti opzionali; almeno uno richiesto)

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `caption` | string | No | Nuovo caption |
| `image_prompt` | string | No | Prompt immagine |
| `platforms` | string[] | No | Piattaforme target |
| `content_type` | string | No | Tipo contenuto |
| `format` | string | No | `single_image` \| `carousel` \| `text_post` \| `link_post` \| `video` |
| `slot` | string | No | Slot ricorrente |
| `product_name` | string | No | Prodotto in evidenza |
| `first_comment` | string | No | Primo commento |
| `title` | string | No | Titolo (Reddit/carousel) |
| `link_url` | string \| null | No | URL link post |
| `subreddit` | string | No | Subreddit |
| `media_url` | string \| null | No | `null` → pulisce l'immagine (text-only) |
| `platform_captions` | object \| null | No | Override caption per piattaforma; `null` → rimuove |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"No fields to update"}` |
| `400` | `{"error":"Invalid format. Use one of: single_image, carousel, text_post, link_post, video"}` |
| `404` | `{"error":"Post not found"}` |
| `500` | `{"error":"<messaggio errore DB>"}` |

**Esempio**:

```bash
curl -s -X PUT "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{"caption":"Nuovo caption","platforms":["instagram","x"]}'
```

---

## `DELETE /api/v1/brands/:slug/posts/:id`

Elimina un singolo post. Solo post in status `pending_user`.

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"Post not found"}` |
| `400` | `{"error":"Can only delete pending posts"}` |
| `500` | `{"error":"<messaggio errore DB>"}` |

**Esempio**:

```bash
curl -s -X DELETE "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/posts/:id/approve`

Approva un post `pending_user` e lo invia a Zernio per la programmazione. Il post passa a `scheduled` (o resta `approved` senza account collegati).

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "status": "published" }
```

Senza account collegati per la piattaforma:

```json
{ "ok": true, "status": "approved", "noAccount": true, "message": "Approved, but not scheduled: no connected account for this platform yet." }
```

**Errori specifici** (status `400`)

| Body |
|---|
| `{"error":"Post not found"}` |
| `{"error":"Post is <status>, not pending_user"}` |
| `{"error":"<reason>"}` — scheduling fallito (es. caption oltre limite o rifiuto Zernio) |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID/approve" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/posts/:id/publish`

Pubblica immediatamente un post già approvato tramite Zernio.

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "status": "published" }
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"Post not found"}` |
| `500` | `{"error":"Publish failed: <dettaglio>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID/publish" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/posts/:id/reschedule`

Ri-programma un post: annulla la copia esistente su Zernio, riporta lo status ad `approved` e ripubblica con il nuovo orario.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `scheduled_for` | string | Sì | Datetime ISO (es. `2026-08-20T18:00`). Senza offset → timezone del brand; con `Z`/`±hh:mm` rispettato |

**Response** `200`:

```json
{
  "ok": true,
  "scheduled_for": "2026-08-20T16:00:00.000Z",
  "scheduled_for_local": "2026-08-20 18:00 (Europe/Rome)",
  "noAccount": false
}
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"scheduled_for is required"}` |
| `400` | `{"error":"Invalid scheduled_for: <valore>"}` |
| `404` | `{"error":"Post not found"}` |
| `500` | `{"error":"<messaggio errore DB>"}` / `{"error":"Publish failed: <dettaglio>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID/reschedule" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{"scheduled_for":"2026-08-20T18:00"}'
```

---

## `POST /api/v1/brands/:slug/posts/:id/render`

Genera l'immagine mancante dal `image_prompt` del post (per i carousel usa i prompt `image_prompts` salvati). Fattura un render (gate crediti).

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "url": "https://…/media/….png", "error": null }
```

Render fallito senza eccezione:

```json
{ "ok": true, "url": null, "error": "no image produced" }
```

Post che ha già un'immagine (nessuna azione):

```json
{ "error": "Post already has an image", "url": "https://…/media/….png" }
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"Post not found"}` |
| `400` | `{"error":"Post has no image_prompt"}` |
| `500` | `{"error":"Render failed: <dettaglio>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID/render" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/posts/:id/media`

Stato compatto del post: identità, campi testo e (per i carousel) ogni slide con prompt e origine del visual.

**Response** `200`:

```json
{
  "content_type": "generated_image",
  "format": "carousel",
  "platform": "instagram",
  "platforms": ["instagram"],
  "caption": "…",
  "title": null,
  "first_comment": null,
  "link_url": null,
  "subreddit": null,
  "media_url": "https://…/slide-0.png",
  "image_prompt": null,
  "is_carousel": true,
  "slide_count": 3,
  "slides": [
    {
      "index": 0,
      "image_prompt": "…",
      "has_image": true,
      "url": "https://…/slide-0.png",
      "media_origin": "ai_generated",
      "media_origin_note": "…"
    }
  ],
  "status": "pending_user",
  "text_only": false,
  "media_origin": "ai_generated",
  "media_origin_note": "This visual is an AI-generated photo…"
}
```

Note: per i video compaiono anche `is_video`, `video_thumbnail_url`, `video_editing_note`; per i visual tipografici `media_origin: "typographic_graphic"` con oggetto `graphic`. Post inesistente: `{"error":"Post not found"}` sempre con status 200.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID/media" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/posts/:id/media`

Azioni sul visual del post: `regenerate` (rifinisce/rimpiazza l'immagine), `slide` (re-render di una slide), `restructure` (riordina/rimuove slide, senza render né crediti), `video` (animazione in clip). Le azioni con render passano dal gate crediti e fatturano un render.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `action` | string | Sì | `regenerate` \| `slide` \| `restructure` \| `video` |
| `instruction` | string | No | Istruzione di modifica (per `regenerate` serve instruction o prompt) |
| `prompt` | string | No | Nuovo prompt completo |
| `index` | number | No | Solo `slide`: indice slide (0 = cover) |
| `order` | number[] | Solo `restructure` | Nuovo ordine degli indici slide, es. `[0,2,1]` |
| `duration` | number | No | Solo `video`: durata in secondi |
| `script` | string | No | Solo `video`: script parlato |
| `aspectRatio` | string | No | Solo `video`: `9:16` \| `1:1` \| `16:9` \| `4:3` \| `3:4` \| `21:9` |

**Response** `200` — per azione:

```json
{ "success": true, "slide_count": 2 }                                          // restructure
{ "success": true, "rendered": true, "media_url": "https://…/media/….png", "notes": "…" }  // regenerate
{ "success": true, "slide_index": 1, "rendered": true }                        // slide
{ "success": true, "media_url": "https://…/media/….mp4", "duration_seconds": 6, "videos_left": 4, "remake": false }  // video
```

**Errori specifici** (status `400`, oltre ai comuni + gate crediti)

| Body |
|---|
| `{"error":"Missing order"}` |
| `{"error":"Missing instruction or prompt"}` |
| `{"error":"Missing index"}` |
| `{"error":"Invalid aspectRatio. Use 9:16, 1:1, 16:9, 4:3, 3:4 or 21:9."}` |
| `{"error":"Unknown action: <action>"}` |
| `{"error":"…"}` per errori applicativi (es. "Post not found", "This is a carousel — edit a specific slide instead.", "Monthly video budget exhausted for this plan.") |

**Esempi**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID/media" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{"action":"regenerate","instruction":"Rendi i colori più caldi"}'

curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID/media" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{"action":"restructure","order":[0,2,1]}'

curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID/media" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{"action":"video","duration":6,"script":"…","aspectRatio":"9:16"}'
```

---

## `POST /api/v1/brands/:slug/posts/:id/revoke`

Ritira un post live (`published`/`scheduled`): elimina best-effort le copie su Zernio, riporta il post a `pending_user` con `revoked_at` e segna i log `revoked`.

**Body** (opzionale)

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `reason` | string | No | Motivo del ritiro; salvato nei publish_logs |

**Response** `200`:

```json
{ "ok": true, "status": "pending_user", "deleted": 2, "failedDeletes": [] }
```

Con eliminazioni fallite:

```json
{
  "ok": true,
  "status": "pending_user",
  "deleted": 1,
  "failedDeletes": [ { "externalPostId": "12345", "error": "…" } ]
}
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"Post not found"}` |
| `400` | `{"error":"not_publishable"}` (post non in `published`/`scheduled`) |
| `400` | `{"error":"DB update failed: <messaggio>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts/POST_ID/revoke" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{"reason":"Contenuto non conforme"}'
```

---

## `POST /api/v1/brands/:slug/posts/approve-all`

Approva tutti i post `pending_user` non flaggati `needs_attention` (uno per uno, in ordine di `slot`).

**Body**: nessuno

**Response** `200`:

```json
{
  "results": [
    { "id": "a1b2c3d4-…", "ok": true },
    { "id": "b2c3d4e5-…", "ok": false, "error": "Did not meet platform requirements" },
    { "id": "c3d4e5f6-…", "ok": true, "noAccount": true }
  ]
}
```

Nessun post pendente:

```json
{ "results": [], "message": "No pending posts" }
```

Note: i fallimenti per singolo post finiscono in `results`, non nello status HTTP.

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/posts/approve-all" \
  -H "Authorization: Bearer $TOKEN"
```
