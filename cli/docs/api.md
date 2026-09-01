# API Reference

Tutti gli endpoint sono sotto `/api/v1/` e richiedono autenticazione Bearer token.

## Autenticazione

```
Authorization: Bearer <jwt_token>
```

Il token viene ottenuto tramite il flow OAuth della CLI. Viene salvato in `~/.config/anomalia/session.json` e rinnovato automaticamente.

## Brand

### GET /api/v1/brands

Lista tutti i brand dell'utente.

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "My Brand",
    "slug": "my-brand",
    "plan": "pro",
    "status": "active",
    "autopilot_enabled": true,
    "autopilot_failure_count": 0,
    "last_autopilot_run_at": "2026-06-19T10:00:00Z",
    "timezone": "Europe/Rome",
    "pendingCount": 3
  }
]
```

### GET /api/v1/brands/:slug

Dettaglio completo di un brand.

**Response:**
```json
{
  "brand": { ... },
  "pendingCount": 3,
  "runs": [{ "status": "completed", "posts_created": 5, "created_at": "...", "error": null }],
  "plan": { "id": "...", "status": "active", "cadence": "5/week", "weeks": [...] },
  "productCount": 12,
  "accountCount": 3,
  "scheduledCount": 8,
  "publishedCount": 45,
  "hasGtm": true,
  "hasContentPlans": true,
  "hasHistory": true,
  "kit": { "about": "...", "brand_colors": ["#fff"] },
  "logoUrl": "https://..."
}
```

## Posts

### GET /api/v1/brands/:slug/posts

Lista post con filtro opzionale.

**Query params:**
- `status` (opzionale): `pending_user`, `approved`, `scheduled`, `published`, `failed`

**Response:**
```json
[
  {
    "id": "uuid",
    "brand_id": "uuid",
    "platform": "instagram",
    "caption": "...",
    "status": "pending_user",
    "slot": "2026-06-20T10:00:00Z",
    "scheduled_for": "2026-06-20T10:00:00Z",
    "pillar": "educational",
    "format": "carousel",
    "product_name": "Pizza Margherita",
    "created_at": "2026-06-19T08:00:00Z"
  }
]
```

### POST /api/v1/brands/:slug/posts/:id/approve

Approva e pubblica un singolo post.

**Response:**
```json
{ "ok": true, "status": "published" }
```

### POST /api/v1/brands/:slug/posts/approve-all

Approva tutti i post pending.

**Response:**
```json
{
  "results": [
    { "id": "uuid", "ok": true },
    { "id": "uuid", "ok": false, "error": "..." }
  ]
}
```

## Strategia

### GET /api/v1/brands/:slug/editorial-plan

Piano editoriale attivo e proposto.

### GET /api/v1/brands/:slug/weekly-plan

Piano settimanale con seeds e quota.

### GET /api/v1/brands/:slug/gtm

GTM Roadmap con fasi e KPI.

### GET /api/v1/brands/:slug/voice

Voice framework e regole per platform.

## Analytics

### GET /api/v1/brands/:slug/analytics

Analytics completi.

### GET /api/v1/brands/:slug/calendar?month=YYYY-MM

Calendario mensile.

## Studio

### GET /api/v1/brands/:slug/studio

Studio completo (brand kit, products, people, competitors, documents).

### PUT /api/v1/brands/:slug/studio/kit

Aggiorna brand kit.

**Body:**
```json
{
  "about": "...",
  "category": "...",
  "target_audience": "...",
  "brand_style": "...",
  "language": "it"
}
```

### PUT /api/v1/brands/:slug/studio/colors

Imposta colori brand.

**Body:**
```json
{ "colors": ["#7c5cff", "#ffffff"] }
```

### POST /api/v1/brands/:slug/studio/people

Crea persona (reale o AI).

**Body (persona reale):** `consent: true` è obbligatorio — è l'attestazione di chi chiama, senza
la quale la persona non viene creata (`400`).
```json
{
  "name": "Marco",
  "role": "CEO",
  "description": "...",
  "kind": "real",
  "consent": true
}
```

**Body (persona AI):**
```json
{
  "name": "Sofia",
  "role": "Influencer",
  "kind": "ai",
  "gender": "female",
  "ageRange": "26-35",
  "vibe": "professional"
}
```

### DELETE /api/v1/brands/:slug/studio/people/:id

Elimina persona.

### POST /api/v1/brands/:slug/studio/documents

Aggiungi nota o documento.

**Body:**
```json
{
  "title": "Tone of voice",
  "content_text": "Siamo amichevoli...",
  "kind": "note"
}
```

### DELETE /api/v1/brands/:slug/studio/documents/:id

Elimina documento.

### POST /api/v1/brands/:slug/studio/competitors

Aggiungi competitor.

**Body:**
```json
{
  "name": "RivalCo",
  "website": "rivalco.com",
  "kind": "direct",
  "rationale": "Compete nel nostro settore"
}
```

### PUT /api/v1/brands/:slug/studio/competitors/:id

Modifica competitor.

### DELETE /api/v1/brands/:slug/studio/competitors/:id

Elimina competitor.

### POST /api/v1/brands/:slug/studio/competitors/research

Ricerca competitor con AI.

**Response:**
```json
{ "ok": true, "found": 5, "added": 3 }
```

### POST /api/v1/brands/:slug/studio/history/sync

Sincronizza storico post dai social.

**Response:**
```json
{ "synced": 24 }
```

## Posts (editing)

### PUT /api/v1/brands/:slug/posts/:id

Modifica un post.

**Body:**
```json
{
  "caption": "Nuovo testo",
  "image_prompt": "Un caffè artigianale",
  "platforms": ["instagram", "facebook"],
  "content_type": "carousel",
  "slot": "2026-06-20T10:00:00Z",
  "product_name": "Pizza Margherita"
}
```

### DELETE /api/v1/brands/:slug/posts/:id

Elimina un post (solo status `pending_user`).

### POST /api/v1/brands/:slug/posts/:id/reschedule

Riprogramma un post.

**Body:**
```json
{ "scheduled_for": "2026-06-20T10:00:00Z" }
```

### POST /api/v1/brands/:slug/posts/:id/publish

Pubblica immediatamente un post.

## Strategia

### POST /api/v1/brands/:slug/editorial-plan/update

Modifica il piano editoriale.

**Body:**
```json
{
  "voice": { "mood": "friendly", "tone": "casual" },
  "cadence": "5/week",
  "platform_mix": { "instagram": 0.6, "tiktok": 0.4 },
  "week_index": 0,
  "week_theme": "Dietro le quinte",
  "week_brief": "Mostra il processo creativo"
}
```

### POST /api/v1/brands/:slug/gtm/update

Modifica il piano GTM.

**Body:**
```json
{
  "objective": "Aumentare brand awareness",
  "phase_index": 0,
  "phase_name": "Lancio",
  "phase_objective": "Raggiungere 1000 follower",
  "platform_weights": { "instagram": 0.7, "tiktok": 0.3 },
  "pillars": ["educational", "behind-the-scenes"]
}
```

### POST /api/v1/brands/:slug/voice/update

Modifica il voice framework.

**Body:**
```json
{
  "mood": "energico",
  "tone": "friendly",
  "register": 40,
  "emotion": "entusiasta",
  "character": "amichevole",
  "syntax": "short",
  "platform_instructions": { "instagram": "Usa emoji con moderazione" },
  "avoid": ["costoso", "economico"]
}
```

## Prodotti

### PUT /api/v1/brands/:slug/products/:id

Modifica un prodotto.

**Body:**
```json
{
  "title": "Pizza Gourmet",
  "description": "La nostra pizza signature",
  "pricing": "€12",
  "featured": true
}
```

### DELETE /api/v1/brands/:slug/products/:id

Elimina un prodotto.

## Persone

### PUT /api/v1/brands/:slug/people/:id

Modifica una persona.

**Body:**
```json
{
  "name": "Marco Rossi",
  "role": "CEO",
  "description": "Fondatore",
  "attributes": { "gender": "male", "ageRange": "36-50" }
}
```

## Errori

Tutti gli endpoint restituiscono errori in questo formato:

```json
{ "error": "Messaggio di errore" }
```

Codici HTTP:
- `401` — Token mancante o invalido
- `404` — Brand o risorsa non trovata
- `500` — Errore interno del server
