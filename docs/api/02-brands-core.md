# API — 02 · Brand core

Endpoint per listare brand, leggere il dettaglio, analytics, calendario, bio, publishing,
diagnosi del brand e obiettivi della chat.
Errori comuni di auth: vedi [01-overview](01-overview.md).

## `GET /api/v1/brands`

Elenco di tutti i brand accessibili all'utente autenticato (per API key: limitato allo scope `brand_ids` della chiave), con il conteggio dei post in attesa di approvazione.

**Query params**: nessuno

**Response** `200` (array, vuoto `[]` se nessun brand):

```json
[
  {
    "id": "6f2c…",
    "name": "Mio Brand",
    "slug": "mio-brand",
    "plan": "pro",
    "status": "active",
    "autopilot_enabled": true,
    "autopilot_failure_count": 0,
    "last_autopilot_run_at": "2026-08-12T08:30:00Z",
    "timezone": "Europe/Rome",
    "pendingCount": 3
  }
]
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands" -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug`

Dettaglio completo del brand: riga `brands` completa unita agli aggregati calcolati da `getBrandDetail` (conteggi, ultimi run autopilot, piano editoriale attivo, kit).

**Response** `200`:

```json
{
  "id": "6f2c…",
  "org_id": "019e…",
  "name": "Mio Brand",
  "slug": "mio-brand",
  "status": "active",
  "plan": "pro",
  "timezone": "Europe/Rome",
  "target_platforms": ["instagram", "tiktok"],
  "launched_at": "2026-05-01T00:00:00Z",
  "content_prefs": { "…": "…" },
  "setup_step": null,
  "setup_completed_at": "2026-05-01T10:00:00Z",
  "autopilot_enabled": true,
  "autopilot_failure_count": 0,
  "last_autopilot_run_at": "2026-08-12T08:30:00Z",
  "zernio_profile_id": "zp_…",
  "ads_settings": { "…": "…" },
  "pendingCount": 3,
  "runs": [
    { "status": "success", "posts_created": 5, "created_at": "2026-08-12T08:30:00Z", "error": null }
  ],
  "plan": {
    "id": "…",
    "status": "active",
    "cadence": "3/week",
    "weeks": [ { "…": "contenuti generati da AI" } ]
  },
  "productCount": 4,
  "accountCount": 2,
  "scheduledCount": 6,
  "publishedCount": 120,
  "hasGtm": true,
  "hasContentPlans": true,
  "hasHistory": true,
  "kit": { "about": "…", "brand_colors": ["#7c5cff", "#ffffff"] },
  "logoUrl": "https://…/logo.png"
}
```

Note: `plan` è `null` senza piano attivo; `kit` è `null` senza riga `brand_kit`; `runs` contiene al massimo gli ultimi 3 run; `content_prefs`, `ads_settings` e `plan.weeks` contengono dati dinamici.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand" -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/analytics`

Analytics del brand: conteggi per status, distribuzione per piattaforma, prossimi post programmati, ultimi log di pubblicazione, performance social aggregate e top post per engagement.

**Response** `200`:

```json
{
  "total": 129,
  "scheduled": 6,
  "pending": 3,
  "failed": 1,
  "platforms": [["instagram", 89], ["tiktok", 40]],
  "upcomingPosts": [
    { "id": "…", "platform": "instagram", "caption": "…", "scheduled_for": "2026-08-14T09:00:00Z", "slot": "2026-08-14" }
  ],
  "recentActivity": [
    { "id": "…", "post_id": "…", "platform": "instagram", "status": "published", "caption": "…", "error": null, "created_at": "2026-08-12T09:01:00Z" }
  ],
  "socialPerformance": [
    { "platform": "instagram", "posts": 34, "totals": { "views": 12000, "likes": 540, "comments": 60, "shares": 25 } }
  ],
  "topPosts": [
    {
      "id": "…",
      "platform": "instagram",
      "caption": "…",
      "thumbnail_url": "https://…",
      "url": "https://instagram.com/p/…",
      "published_at": "2026-08-01T10:00:00Z",
      "metrics": { "views": 4500, "likes": 220, "comments": 18, "shares": 9 }
    }
  ],
  "products": 4,
  "accounts": 2
}
```

Note: `platforms` è un array di coppie `[piattaforma, numero post]`; `topPosts` max 6 post ordinati per score di engagement; `recentActivity` max 8 log.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/analytics" -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/calendar`

Calendario editoriale del mese: post programmati (per `scheduled_for` o per `slot`, deduplicati, esclusi i `pending_user`) più le bozze pending (flag `isDraft`).

**Query params**

| Param | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `month` | string `YYYY-MM` | No | Mese da visualizzare; se assente o non valido usa il mese corrente |

**Response** `200`:

```json
{
  "posts": [
    {
      "id": "…",
      "platform": "instagram",
      "caption": "…",
      "media_url": "https://…",
      "scheduled_for": "2026-08-14T09:00:00Z",
      "status": "scheduled",
      "slot": "2026-08-14"
    },
    {
      "id": "…",
      "platform": "tiktok",
      "caption": "…",
      "media_url": null,
      "scheduled_for": null,
      "status": "pending_user",
      "slot": null,
      "isDraft": true
    }
  ],
  "year": 2026,
  "month": 8,
  "monthLabel": "August 2026",
  "prevYM": "2026-07",
  "nextYM": "2026-09",
  "timezone": "Europe/Rome"
}
```

Note: `monthLabel` segue la lingua del brand (`content_prefs.language`, fallback inglese); `prevYM`/`nextYM` gestiscono il riporto d'anno. Max 100 post programmati + 50 bozze; i post bozza non hanno `scheduled_for`/`slot`.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/calendar?month=2026-08" -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/bio`

Stato del "link in bio": URL corrente su `social_accounts.bio_url` dell'account attivo e link breve suggerito (quello con più click negli ultimi 7 giorni).

**Query params**

| Param | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `platform` | string | No | Filtra l'account su una piattaforma; se assente usa il primo account attivo |

**Response** `200`:

```json
{
  "bioUrl": "https://mio-brand.com/lp-offerta",
  "suggested": {
    "code": "Ab3xYz9q",
    "url": "https://anomalia.so/l/Ab3xYz9q",
    "clicks": 41,
    "targetUrl": "https://mio-brand.com/pagina-prodotto"
  }
}
```

Note: `suggested` è `null` se nessun link ha ricevuto click nella settimana; `bioUrl` è `null` se nessun account attivo.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/bio?platform=instagram" -H "Authorization: Bearer $TOKEN"
```

---

## `PUT /api/v1/brands/:slug/bio`

Memorizza il link in bio sull'account attivo. Nota: l'applicazione effettiva sul profilo social è manuale (Zernio non espone le bio via API) — salva solo il valore.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `platform` | string | No | Seleziona l'account per piattaforma; se assente usa il primo account attivo |
| `bio_url` | string | Sì | URL http(s) valido (max 500 char); stringa vuota `""` per svuotare la bio |

**Response** `200`:

```json
{ "ok": true, "bioUrl": "https://mio-brand.com/lp-offerta" }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"Invalid body"}` |
| `400` | `{"error":"bio_url is required"}` |
| `400` | `{"error":"bio_url is invalid"}` |
| `400` | `{"error":"bio_url must be an http(s) URL or empty"}` |
| `404` | `{"error":"No active social account"}` |
| `500` | `{"error":"<messaggio errore DB>"}` |

**Esempio**:

```bash
curl -s -X PUT "https://anomalia.so/api/v1/brands/mio-brand/bio" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"instagram","bio_url":"https://mio-brand.com/lp-offerta"}'
```

---

## `GET /api/v1/brands/:slug/publishing`

Livello di pubblicazione corrente (`brands.content_prefs.publishing.mode`) e account attivi con flag `auto_publish`.

**Response** `200`:

```json
{
  "mode": "manual",
  "accounts": [
    { "id": "…", "platform": "instagram", "auto_publish": true },
    { "id": "…", "platform": "tiktok", "auto_publish": false }
  ]
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/publishing" -H "Authorization: Bearer $TOKEN"
```

---

## `PUT /api/v1/brands/:slug/publishing`

Imposta il livello di pubblicazione: `manual` (solo account auto-publish immediati, il resto attende l'approvazione email), `auto_curated` (pubblica tutto tranne i post `needs_attention`), `auto_all` (pubblica tutto).

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `mode` | string | Sì | `manual` \| `auto_curated` \| `auto_all` |

**Response** `200`:

```json
{ "ok": true, "mode": "auto_curated" }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"Invalid JSON body"}` |
| `400` | `{"error":"Invalid mode. Must be one of: manual, auto_curated, auto_all"}` |
| `500` | `{"error":"<messaggio errore RPC>"}` |

**Esempio**:

```bash
curl -s -X PUT "https://anomalia.so/api/v1/brands/mio-brand/publishing" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"auto_curated"}'
```

---

## `POST /api/v1/brands/:slug/tick`

Esegue manualmente un tick dell'autopilot per il brand (spende crediti AI). Nessun body.

**Response** `200` (inoltro della risposta del tick interno):

```json
{
  "ok": true,
  "considered": 1,
  "processed": 1,
  "skipped": 0,
  "errors": [],
  "reconciliation": { "checked": 0, "divergent": 0 }
}
```

Note: `skipped > 0` indica brand non "due" per cadenza o run già in corso; `errors` è un array di `{ "brand": "<slug>", "reason": "…" }`.

**Errori specifici**

| Status | Body |
|---|---|
| `402` | `{"error":"credits_exhausted"}` |
| `503` | `{"error":"Autopilot tick is not configured: AUTOPILOT_SECRET (or CRON_SECRET) env var is missing."}` |
| `500` | `{"error":"Tick failed: <testo risposta interna>"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/tick" -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/media`

Elenca la libreria media del brand, dalla più recente, con una URL firmata per l'anteprima.
Gli id restituiti sono quelli che `POST /posts` accetta in `media_ids`.

**Query params**

| Param | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `query` | string | No | Filtro libero su titolo, descrizione e tag |
| `limit` | number | No | 1–200, default 100 |

**Response** `200`:

```json
{
  "media": [
    {
      "id": "a1b2c3d4-…",
      "kind": "image",
      "mime": "image/png",
      "width": 1080,
      "height": 1350,
      "title": "Foto prodotto",
      "description": "…",
      "tags": ["prodotto"],
      "url": "https://anomalia.so/a/K7BX2MQ4",
      "created_at": "2026-08-13T10:00:00.000Z"
    }
  ]
}
```

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/media?query=logo&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/media`

Copia un'immagine o un video pubblicati altrove dentro la libreria del brand, e restituisce
l'id che `POST /posts` accetta in `media_ids`. Nessun modello viene chiamato e nessun credito
viene speso: il file viene copiato, non generato.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `url` | string | Sì | URL pubblico **https** dell'immagine o del video |
| `title` | string | No | Il nome con cui l'asset compare in libreria |

**Cosa viene rifiutato** — la richiesta si ferma prima che un solo byte raggiunga lo Storage:

| Errore | Status | Quando |
|---|---|---|
| `not_https` | `400` | L'URL non è https |
| `blocked_host` | `400` | Host privato/loopback/link-local, un nome che risolve su uno di quelli, un redirect che ci finisce dentro, un redirect che scende a http, o un host che non risolve |
| `fetch_failed` | `400` | Timeout, connessione fallita, troppi redirect, risposta non 2xx |
| `unsupported_type` | `415` | Content-type fuori da `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`, `video/quicktime`, `video/webm` |
| `too_large` | `413` | Immagine oltre 12MB o video oltre 64MB — sia dichiarati nel `content-length` sia misurati mentre il corpo arriva |
| `empty` | `400` | Corpo vuoto |
| `store_failed` | `502` | Lo Storage o la riga di libreria non si sono scritti |

**Response** `200`:

```json
{
  "ok": true,
  "id": "a1b2c3d4-…",
  "kind": "image",
  "mime": "image/png",
  "bytes": 481920,
  "width": 1080,
  "height": 1350,
  "source_url": "https://cdn.example.com/render/final.png",
  "url": "https://anomalia.so/a/K7BX2MQ4"
}
```

`source_url` è l'ultimo URL della catena di redirect: è quello da cui il file è arrivato davvero,
ed è il valore conservato come provenienza sulla riga di libreria.

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/media" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://cdn.example.com/render/final.png","title":"Chiusura campagna"}'
```

---

## `GET /api/v1/brands/:slug/doctor`

Tool MCP: `diagnose_brand`.

Perché questo brand non riceve niente dall'AI. Per ogni ciclo ricorrente coperto (pubblicazione,
autopilot, analytics review): il **primo** cancello che non passa, cosa deve succedere perché
passi, e l'ultimo esito registrato in `loop_ticks`. Lettura pura: nessuna scrittura, nessuna AI,
nessun credito.

`notCovered` non è un dettaglio: dichiara i cicli che questa diagnosi **non** guarda, così un
«nessun blocco» non viene letto come «tutto il prodotto sta funzionando».

**Query params**: nessuno

**Response** `200`:

```json
{
  "brand": { "name": "Demo Brand", "slug": "demo", "plan": "pro" },
  "generatedAt": "2026-09-04T08:00:00Z",
  "headline": "publishing: nessun post approvato in attesa → approva un post",
  "loops": [
    {
      "loop": "publishing",
      "schedule": "ogni 15 minuti",
      "status": "blocked",
      "blockedBy": "has_approved_posts",
      "gates": [
        { "id": "plan_allows", "status": "pass", "detail": "Piano pro" },
        {
          "id": "has_approved_posts",
          "status": "fail",
          "detail": "0 post approvati in attesa",
          "fix": "Approva un post pendente"
        }
      ],
      "lastRun": { "at": "2026-09-04T07:45:00Z", "outcome": "skipped", "reason": "nothing_to_publish" }
    }
  ],
  "notCovered": ["seo", "geo", "radar", "field", "blog", "ads", "weekly_recap"]
}
```

`status` di un ciclo: `ok` · `blocked` (un cancello lo esclude) · `waiting` (passa i cancelli ma
non è ancora il suo turno) · `failing` · `unknown`. `status` di un cancello: `pass` · `fail` ·
`unknown`; `fix` c'è solo su `fail`. `blockedBy` è l'id del primo cancello fallito, `null` quando
non ce n'è.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/doctor" -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/v1/brands/:slug/goals`

Tool MCP: `get_goals`.

La storia della modalità obiettivo, e il riepilogo che risponde alla domanda vera su una funzione
nuova: **funziona?** Non quanti obiettivi ci sono, ma quanti si chiudono al primo colpo, quanti
tornano alla persona, quante riprese automatiche sono costati e per quale ragione le catene si
fermano. Lettura pura: nessuna scrittura, nessuna AI, nessun credito.

**Query**

| Param | Default | Note |
|---|---|---|
| `limit` | `20` | quanti obiettivi, max 100 |
| `thread` | *(tutti)* | solo gli obiettivi di una conversazione |

**Response** `200`:

```json
{
  "brand": "mio-brand",
  "summary": {
    "goals": 3,
    "open": 1,
    "met": 1,
    "handed_back": 1,
    "abandoned": 0,
    "met_first_pass": 1,
    "laps": 2,
    "stopped_by": { "out_of_time": 1 },
    "criteria_done": 4,
    "criteria_dropped": 1,
    "criteria_open": 2
  },
  "goals": [
    {
      "id": "…",
      "statement": "Pubblica tre post questa settimana",
      "status": "met",
      "source": "user",
      "laps": 0,
      "criteria": [{ "id": "c1", "text": "primo post", "status": "done", "note": null }],
      "created_at": "2026-09-01T08:00:00Z",
      "closed_at": "2026-09-01T09:00:00Z",
      "closing_note": null,
      "events": [
        {
          "kind": "opened",
          "reason": null,
          "actor": "user",
          "progress": "0/3",
          "closed_now": 0,
          "laps": 0,
          "queued": null,
          "at": "2026-09-01T08:00:00Z"
        }
      ]
    }
  ]
}
```

`status` di un obiettivo: `open` · `met` · `handed_back` · `abandoned`. `status` di un criterio:
`open` · `done` · `dropped`. `laps` sono le riprese automatiche consumate — la voce di spesa
della funzione.

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/goals?limit=50" \
  -H "Authorization: Bearer $TOKEN"
```
