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
| `media_ids` | string[] | No | Fino a 8 id **interi** dalla libreria del brand (`GET /media`): a differenza di un id di post, un id media non si risolve da un prefisso. Un id che non è di questo brand fa fallire la creazione: il post non nasce mai senza. Il nono id è rifiutato (`invalid_input`), non scartato |
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
| `400` | `{"error":"media_not_found"}` — un id media non è di questo brand (o non esiste: le due cose non si distinguono). Colpa di chi chiama: l'id va corretto |
| `403` | `{"error":"API key is read-only"}` |
| `502` | `{"error":"media_unavailable"}` — il media è di questo brand ma non siamo riusciti ad allegarlo. Guasto nostro: riprovare con altri id non serve |

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

## `POST /api/v1/brands/:slug/content/check`

Fa girare su una copy che hai scritto tu **gli stessi controlli deterministici** che Anomalia fa
sulla propria: requisiti di piattaforma, tenuta della caption, punteggio di qualità, calendario.

Non chiama nessun modello, non consuma crediti e **non scrive niente**: è una POST solo perché
porta un body. La stessa richiesta restituisce sempre lo stesso verdetto. Non guarda i pixel:
giudicare un'immagine o un video è un'azione separata e a pagamento.

**Una API key di sola lettura oggi non può chiamarlo** e riceve `403`. Non è una proprietà di
questo endpoint: `resolveCaller` nega a una chiave `read` **ogni** richiesta che non sia `GET` o
`HEAD`, perché finora ogni route che muta era una non-GET. `check_content` è il primo POST che
calcola senza scrivere, quindi il primo controesempio a quella regola; cambiarla è una decisione
a parte, con un raggio d'azione molto più ampio di questo endpoint.

Un verdetto negativo è comunque un `200` con `ok: false` — è un referto, non un cancello.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `platforms` | string[] | Sì | Dove uscirebbe. Le sconosciute → `no_platforms` |
| `caption` | string | Sì | La copy. Letta, punteggiata e restituita intatta |
| `platform_captions` | object | No | Override per piattaforma: ognuna è controllata sulla copy che pubblicherebbe davvero |
| `media_ids` | string[] | No | Fino a 8 id della libreria del brand. Un id che non è di questo brand è riportato |
| `title` | string | No | Obbligatorio per Reddit |
| `scheduled_for` | string | No | Istante proposto, ISO. Senza offset è letto sul fuso del brand |

Sono i campi che portano una regola: `subreddit` e `link_url`, che `create_post` accetta, qui non
hanno nessun controllo dietro e vengono rifiutati dallo schema invece di essere ignorati.

**Response** `200`:

```json
{
  "ok": false,
  "errors": [
    { "code": "over_limit", "field": "caption", "detail": "X: 812 characters, limit 280" }
  ],
  "warnings": [
    { "code": "calendar_conflict", "field": "scheduled_for", "detail": "2030-05-16T07:00 is already taken by a1b2c3d4-…" }
  ],
  "scores": [
    {
      "platform": "linkedin",
      "index": 62.4,
      "checks": [
        { "id": "hook_strength", "value": 0.4, "weight": 18, "note": "apre parlando del brand" }
      ]
    }
  ],
  "versions": { "rules": 1, "scorer": 3 }
}
```

**Errori bloccanti** (dentro `errors`, ognuno col campo da riparare)

| `code` | `field` | Quando |
|---|---|---|
| `no_platforms` | `platforms` | Nessuna piattaforma riconosciuta |
| `caption_empty` | `caption` | Caption senza testo |
| `caption_placeholder` | `caption` | Lorem ipsum, `TODO`, solo hashtag |
| `caption_needs_proof` | `caption` | Resta un marcatore `[NEED: …]`. Si riempie con il fatto, non si cancella |
| `need_media` | `media_ids` | `instagram` / `tiktok` / `youtube` senza asset |
| `need_video` | `media_ids` | `youtube` con un asset che non è un video |
| `over_limit` | `caption` | Copy oltre il limite di una piattaforma (dice quale e di quanto) |
| `reddit_title` | `title` | Reddit senza titolo |
| `media_not_found` | `media_ids` | Un id non è nella libreria di questo brand |
| `invalid_scheduled_for` | `scheduled_for` | Data illeggibile |
| `too_soon` | `scheduled_for` | Data passata o troppo vicina |

**Avvisi** (dentro `warnings`, non bloccano): `calendar_conflict` — quel minuto è già occupato da
un altro post vivo; `reach_chasing_hashtags` — `#fyp`, `#viral` e simili.

**Punteggi**: uno per piattaforma richiesta, con l'indice 0–100 e i dodici check pesati dello
scorer interno (hook, tell da AI, ripetizione rispetto ai post recenti del brand, concretezza,
CTA, lunghezza, leggibilità, hashtag, emoji). `versions` fissa il ruleset e lo scorer: due
verdetti sono confrontabili solo se coincidono.

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"invalid_input","details":[…]}` — body fuori schema |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/content/check" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "platforms": ["linkedin","x"],
    "caption": "Tre cose che abbiamo imparato spedendo di venerdì."
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

---

## `GET /api/v1/brands/:slug/creation-kit`

Il **brief minimo** da leggere *prima* di scrivere un post: vincoli di piattaforma, fatti e voce
del brand, la rubrica che calza, **un solo** template Anomalia scelto per questo obiettivo e
formato, le riscritture del proprietario, cosa ha funzionato su questo brand e quali minuti del
calendario sono già occupati.

Non chiama nessun modello, non consuma crediti e non scrive niente: una API key di sola lettura
può chiamarla. Gli asset stanno in `GET /media`; controllare una bozza è `POST /content/check`.

**La selezione è la funzione.** Il kit non è la libreria: le sezioni senza contenuto sono
**assenti** (mai presenti e vuote), e l'intera risposta è tagliata a `budget_bytes`. Un kit tipico
pesa 3,8–5,4 KB.

**Query**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `goal` | string (≤300) | Sì | Cosa deve fare questo post, in una riga. Sceglie il template e ordina prodotti ed esempi |
| `platforms` | string | Sì | Separate da virgola: `instagram,linkedin`. Normalizzate e deduplicate |
| `format` | enum | Sì | `single_image` \| `carousel` \| `text_post` \| `link_post` \| `video` |

**Response** `200`:

```json
{
  "job": { "goal": "launch the espresso grinder", "platforms": ["linkedin"], "format": "text_post" },
  "versions": { "kit": 1 },
  "size_bytes": 5378,
  "budget_bytes": 8192,
  "trimmed": [],
  "constraints": {
    "platforms": [{ "platform": "linkedin", "char_limit": 3000, "needs_media": false, "video_only": false }],
    "avoid": ["eccellenza", "sinergia"]
  },
  "brand": {
    "name": "Caffè Nero",
    "language": "it",
    "about": "Torrefazione artigianale a Trieste dal 1998…",
    "audience": "Bar indipendenti e uffici…",
    "products": [{ "id": "…", "title": "Espresso grinder Mk II", "pricing": "890 €" }],
    "people": [{ "id": "…", "name": "Marta Rossi", "role": "Head roaster" }]
  },
  "voice": { "text": "BRAND PERSONALITY (authoritative — …)" },
  "rubric": { "id": "…", "name": "Lettere dal lab", "format": "text_post", "art_direction": "foto in bianco e nero" },
  "template": {
    "id": "linkedin-post-templates/the-story-post",
    "name": "The Story Post",
    "group": "LinkedIn Post Templates",
    "body": "[Hook: Unexpected outcome or lesson]…",
    "hooks": { "id": "hook-formulas/story-hooks", "name": "Story Hooks", "body": "- \"Last week, …\"" },
    "playbook": "PLATFORM PLAYBOOK (…): - linkedin — …"
  },
  "calendar": { "occupied": [{ "scheduled_for": "2026-09-05T07:00:00.000Z", "platforms": ["linkedin"], "campaign": "Grinder launch", "step": "announcement" }] },
  "week": { "index": 0, "theme": "La settimana del grinder" },
  "operator_edits": [{ "before": "Siamo entusiasti di annunciare…", "after": "Nuovo grinder. Macina 18g in 4 secondi." }],
  "history": {
    "post_count": 24,
    "best_times": ["Sat 09:00"],
    "top_formats": ["image"],
    "top_hashtags": ["#caffe", "#tostatura"],
    "cadence": "~8 posts/week",
    "untested_hooks": ["contrast", "confession"],
    "winners": [{ "id": "…", "platform": "linkedin", "opening": "Abbiamo rotto il grinder 23 volte." }]
  }
}
```

**Identificatori stabili.** Ogni pezzo selezionato è citabile: `template.id` e `template.hooks.id`
(dal file di riferimento `post-templates.md`), `rubric.id`, `brand.products[].id`,
`brand.people[].id`, `history.winners[].id`. `versions.kit` sale quando cambia la selezione o la
forma della risposta: due kit si confrontano solo se hanno la stessa versione.

**Come sceglie**

| Sezione | Da dove viene | Come è selezionata |
|---|---|---|
| `constraints` | `platform-limits.ts` | Solo le piattaforme richieste |
| `brand` | `brand_kit`, `products`, `people` | Prodotti ordinati per sovrapposizione lessicale col `goal`, massimo 5. Solo le persone che passano `likenessConsented` (reali con consenso attestato, più le persona AI, che non ritraggono nessuno) |
| `voice` | `houseVoiceFor` | La personalità approvata quando c'è, altrimenti la house voice |
| `rubric` | `rubrics` (approvate) | Solo quelle del `format` richiesto, poi la più vicina al `goal` |
| `template` | `post-templates.md` | Un gruppo dal formato+piattaforma, un blocco dal `goal`, più una famiglia di hook |
| `calendar` | `posts` | Solo i minuti già occupati da qui in avanti, massimo 8 |
| `week` | `editorial_plans` attivo | Solo la settimana corrente |
| `operator_edits` | `content_prefs.captionEditPairs` | Le ultime 3 riscritture reali del proprietario |
| `history` | `social_post_history` (`source='zernio'`) | Solo i post del brand, vincitori filtrati sulle piattaforme richieste |

**Il budget.** Ogni campo ha un tetto in caratteri, quindi il kit sta nel budget *per
costruzione*. Se dovesse comunque sforare, le sezioni cedono dalla meno autorevole alla più —
`history`, `operator_edits`, `week`, `calendar`, `template`, `rubric`, `voice`, `brand` — e
`trimmed` elenca cosa è caduto. `constraints` non cade mai. L'ordine è la precedenza dichiarata nel
piano: i vincoli di piattaforma vincono su tutto, e i vincitori passati sono *evidenza*, non
istruzioni.

**Errori**

| `error` | Status | Quando |
|---|---|---|
| `invalid_input` | 400 | Campo mancante, formato sconosciuto o campo non previsto (lo schema è `.strict()`) |
| `no_platforms` | 400 | `platforms` non contiene nessuna piattaforma |

**Esempio**:

```bash
curl -s -G "https://anomalia.so/api/v1/brands/mio-brand/creation-kit" \
  --data-urlencode "goal=launch the espresso grinder" \
  --data-urlencode "platforms=linkedin,instagram" \
  --data-urlencode "format=text_post" \
  -H "Authorization: Bearer $TOKEN"
```
