# API — 05 · Editorial plan

Ciclo del piano editoriale a 4 settimane: proposta, approvazione, revisione, modifica, brief.
Errori comuni di auth: vedi [01-overview](01-overview.md). Le azioni AI (propose/revise/replan-week) consumano crediti.

## `GET /api/v1/brands/:slug/editorial-plan`

Restituisce il piano editoriale attivo, l'eventuale proposta in attesa di revisione, l'indice della settimana corrente e un riepilogo quota.

**Query params**: nessuno

**Response** `200`:

```json
{
  "plan": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "active",
    "strategy": "«Posizionare il brand come...» — testo generato dall'AI",
    "voice": { "mood": "…", "tone": "…", "goal": "…", "personality": "…" },
    "cadence": "3/week",
    "platform_mix": [ { "platform": "instagram", "share": "40%", "role": "…" } ],
    "gtm": {
      "stage": "zero_to_one",
      "summary": "…",
      "platform_recs": [ { "platform": "instagram", "priority": "primary", "why": "…", "organic_potential": "…" } ],
      "plays": ["…"]
    },
    "weeks": [
      {
        "index": 0,
        "week_start": "2026-08-10",
        "theme": "…",
        "focus": "…",
        "content_mix": [{ "type": "educational", "count": 2 }],
        "rationale": "…",
        "brief": null,
        "products": null,
        "status": "upcoming"
      }
    ],
    "parent_id": null,
    "revision_feedback": null,
    "changes_summary": ["…"],
    "source": "manual",
    "created_at": "2026-08-01T10:00:00.000Z",
    "activated_at": "2026-08-01T10:05:00.000Z"
  },
  "proposed": null,
  "proposedFeedback": null,
  "currentWeek": 0,
  "quota": { "used": 12, "remaining": 0 }
}
```

Note: `plan`, `proposed`, `proposedFeedback` sono `null` se non esistono; i campi strategia/voice/settimane sono dati AI. `quota.remaining` = `postQuota(piano) − used` (go 15 / starter 30 / pro 90, fallback go).

**Esempio**:

```bash
curl -s "https://anomalia.so/api/v1/brands/mio-brand/editorial-plan" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/editorial-plan/propose`

Genera da zero la prima (o nuova) proposta di piano editoriale a 4 settimane e la salva come `proposed`. Le proposte precedenti vengono marcate `rejected`. **Consuma crediti.**

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true, "plan_id": "b2c3d4e5-f6a7-8901-bcde-f1234567890" }
```

**Errori specifici**

| Status | Body |
|---|---|
| `500` | `{"error":"Propose failed: …"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/editorial-plan/propose" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/editorial-plan/save`

Salva un piano **scritto fuori da Anomalia**: nessuna chiamata al modello, nessun credito. La riga
prodotta è la stessa di `propose` — `status: "proposed"`, `source: "manual"` — quindi il piano si
legge, si revisiona e si approva dalle stesse superfici. Le proposte precedenti passano a
`rejected`; **il piano attivo non viene toccato**: resta `approve` il passo che attiva.

Il body è validato in modo stretto (`invalid_input` nomina il campo). Un ciclo più corto di 4
settimane viene completato con settimane vuote, come per un piano generato.

**Body**:

```json
{
  "strategy": "Portare fuori il lavoro vero di chi monta le tastiere.",
  "voice": { "mood": "diretto", "tone": "asciutto", "goal": "far provare", "personality": "un artigiano che spiega" },
  "cadence": "3/week",
  "platform_mix": [{ "platform": "instagram", "share": "70%", "role": "vetrina" }],
  "gtm": {
    "stage": "zero_to_one",
    "summary": "…",
    "platform_recs": [{ "platform": "instagram", "priority": "primary", "why": "…", "organic_potential": "…" }],
    "plays": ["…"]
  },
  "weeks": [
    {
      "theme": "Il banco di lavoro",
      "focus": "Mostrare il montaggio a mano",
      "content_mix": [{ "type": "behind the scenes", "count": 3 }],
      "rationale": "…",
      "brief": null,
      "products": ["Tastiera 65%"]
    }
  ]
}
```

Obbligatori: `strategy`, `voice` (tutti e quattro i campi), `cadence` (`3/week` | `5/week` |
`daily`), `platform_mix` (almeno una voce), `weeks` (1–4, ciascuna con `theme`, `focus` e un
`content_mix` non vuoto). Opzionali: `gtm`, e per settimana `rationale`, `brief`, `products`.

**Response** `200`:

```json
{
  "ok": true,
  "plan_id": "b2c3d4e5-f6a7-8901-bcde-f1234567890",
  "status": "proposed",
  "weeks": 4,
  "review_url": "https://anomalia.so/app/mio-brand/editorial"
}
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"invalid_input","details":[…]}` — `details[0].path` nomina il campo |
| `403` | `{"error":"API key is read-only"}` |
| `500` | `{"error":"insert_failed","details":"…"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/editorial-plan/save" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"strategy":"…","voice":{"mood":"…","tone":"…","goal":"…","personality":"…"},"cadence":"3/week","platform_mix":[{"platform":"instagram","share":"70%","role":"vetrina"}],"weeks":[{"theme":"…","focus":"…","content_mix":[{"type":"educational","count":3}]}]}'
```

---

## `POST /api/v1/brands/:slug/editorial-plan/approve`

Attiva la proposta più recente: diventa il piano `active` (con `week_start` calcolati dal lunedì corrente nel timezone del brand), il piano attivo precedente passa a `superseded`, voice+cadence sincronizzati nelle preferenze del brand.

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"No proposed plan to approve"}` |
| `500` | `{"error":"Approve failed: …"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/editorial-plan/approve" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/editorial-plan/discard`

Scarta la proposta: tutte le righe `proposed` del brand passano a `rejected`.

**Body**: nessuno

**Response** `200`:

```json
{ "ok": true }
```

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/editorial-plan/discard" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/v1/brands/:slug/editorial-plan/revise`

Genera via AI una revisione completa del piano attivo a partire da un feedback testuale, salvata come nuova proposta (la precedente marcata `rejected`). **Consuma crediti.**

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `feedback` | string | Sì | Feedback testuale per la revisione |

**Response** `200`:

```json
{
  "ok": true,
  "plan_id": "c3d4e5f6-a789-0123-bcde-f2345678901a",
  "plan": {
    "strategy": "… (dati AI)",
    "voice": { "mood": "…", "tone": "…", "goal": "…", "personality": "…" },
    "cadence": "5/week",
    "platform_mix": [{ "platform": "instagram", "share": "40%", "role": "…" }],
    "gtm": { "stage": "growth", "summary": "…", "platform_recs": [], "plays": [] },
    "weeks": [
      {
        "index": 0,
        "week_start": null,
        "theme": "…",
        "focus": "…",
        "content_mix": [{ "type": "educational", "count": 2 }],
        "rationale": "…",
        "brief": null,
        "products": null,
        "status": "upcoming"
      }
    ],
    "changes_summary": ["…"]
  }
}
```

Note: `weeks` contiene sempre esattamente 4 settimane; `week_start` è `null` finché il piano non è attivato.

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"feedback is required"}` |
| `404` | `{"error":"no active editorial plan"}` |
| `500` | `{"error":"Revise failed: …"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/editorial-plan/revise" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"feedback":"Vorrei più contenuti video e meno post promozionali nella settimana 2"}'
```

---

## `POST /api/v1/brands/:slug/editorial-plan/update`

Modifica campi del piano attivo: voice, cadence, platform_mix e/o tema+brief di una singola settimana. Non usa AI.

**Body** (tutti opzionali, almeno uno richiesto)

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `voice` | object | No | `{mood, tone, goal, personality}` |
| `cadence` | string | No | `3/week` \| `5/week` \| `daily` |
| `platform_mix` | array | No | Nuovo mix piattaforme |
| `week_index` | number | No | Indice settimana (0–3) |
| `week_theme` | string | No | Nuovo tema (usato solo con `week_index`) |
| `week_brief` | string | No | Nuovo brief (usato solo con `week_index`) |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"No fields to update"}` |
| `404` | `{"error":"No active editorial plan"}` |
| `500` | `{"error":"…"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/editorial-plan/update" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cadence":"5/week","week_index":1,"week_theme":"Lancio prodotto X"}'
```

---

## `POST /api/v1/brands/:slug/editorial-plan/save-brief`

Salva sul piano attivo il brief utente (e opzionalmente i prodotti in evidenza) per una settimana specifica.

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `week_index` | number | Sì | Indice della settimana (0–3). Accettato anche come `week` |
| `brief` | string | No | Brief per la settimana; `null` lo azzera |
| `products` | string[] | No | Titoli esatti dei prodotti in evidenza |

**Response** `200`:

```json
{ "ok": true }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"week_index is required"}` |
| `400` | `{"error":"Invalid week_index"}` |
| `404` | `{"error":"No active editorial plan"}` |
| `500` | `{"error":"…"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/editorial-plan/save-brief" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"week_index":2,"brief":"Settimana di lancio: puntare tutto sul nuovo prodotto","products":["Kit meccanico Pro"]}'
```

---

## `POST /api/v1/brands/:slug/editorial-plan/replan-week`

Rigenera via AI una singola settimana del piano attivo attorno a un nuovo brief, mantenendo invariate le altre. **Consuma crediti.**

**Body**

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `week_index` | number | Sì | Indice della settimana (0–3). Accettato anche come `week` |
| `brief` | string | Sì | Nuovo brief autorevole |

**Response** `200`:

```json
{ "ok": true, "week": 2 }
```

**Errori specifici**

| Status | Body |
|---|---|
| `400` | `{"error":"week_index is required"}` |
| `400` | `{"error":"brief is required"}` |
| `400` | `{"error":"invalid week_index"}` |
| `404` | `{"error":"no active editorial plan"}` |
| `500` | `{"error":"Replan failed: …"}` |

**Esempio**:

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/editorial-plan/replan-week" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"week_index":3,"brief":"Settimana Black Friday: sconti e urgenza"}'
```
