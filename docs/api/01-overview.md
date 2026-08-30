# API Reference — Overview

> Reference della REST API pubblica di Anomalia, generata dal codice (`src/routes/api/v1/`) il 13/08/2026.
> Copre gli endpoint consumati dalla CLI (`anomalia-cli`) e dalle integrazioni esterne via API key.

## Base URL

| Ambiente | Base URL |
|---|---|
| Produzione | `https://anomalia.so/api/v1` |
| Dev locale | `http://localhost:5173/api/v1` (con `npm run dev`) |

## Autenticazione

Tutti gli endpoint richiedono un header `Authorization: Bearer <token>`. Il token può essere:

1. **API key** (`anomalia_live_…`) — long-lived, creata da `POST /api/v1/brands/:slug/api-keys` o dal pannello web. Hash SHA-256 nel DB, mostrata una sola volta.
2. **Supabase JWT** — il session token ottenuto da `anomalia login` (browser OAuth).

```bash
# Esempio di chiamata
curl -s "https://anomalia.so/api/v1/brands" -H "Authorization: Bearer $TOKEN"
```

### API key: scope e limiti

- Ogni key ha `permissions.brand_ids` (lista di brand o `"*"`) e `permissions.scopes` (`read`, `write`).
- **Key read-only**: qualsiasi metodo diverso da GET/HEAD viene rifiutato globalmente.
- **Tenant boundary**: con API key, la verifica di ownership del brand viene riapplicata manualmente
  (owner di org o brand member) — un brand fuori scope risponde **404** (non 403), per non rivelare quali slug esistono.
- Le API key **non possono crearne altre** (`POST /api-keys` richiede JWT).

## Errori comuni (tutti gli endpoint)

| Status | Body | Quando |
|---|---|---|
| `401` | `{"error":"Missing or invalid Authorization header"}` | Header Bearer assente |
| `401` | `{"error":"Invalid or expired token"}` | JWT non valido/scaduto |
| `401` | `{"error":"Invalid API key"}` | Key non riconosciuta |
| `404` | `{"error":"Brand not found"}` | Slug inesistente o fuori dallo scope della key |
| `403` | `{"error":"API key is read-only"}` | Scrittura con key senza scope `write` |
| `403` | `{"error":"API key does not have access to this brand"}` | Brand fuori dallo scope `brand_ids` |
| `402` | `{"error":"credits_exhausted"}` | CreditAI esauriti su azione a consumo (vedi sotto) |

Questi errori **non vengono ripetuti** nelle pagine di riferimento: ogni endpoint li può restituire in aggiunta ai propri.

## Azioni a consumo crediti (`gateAiAction`)

Gli endpoint che spendono AI richiedono **piano a pagamento + crediti** e scope `write`. Falliscono con `402 credits_exhausted` o `403 API key is read-only` **prima** di eseguire. Sono:

| Endpoint | Azione |
|---|---|
| `POST /brands/:slug/editorial-plan/propose` | Genera proposta piano editoriale |
| `POST /brands/:slug/editorial-plan/revise` | Revisione piano con feedback |
| `POST /brands/:slug/editorial-plan/replan-week` | Rigenera una settimana |
| `POST /brands/:slug/weekly-plan/plan` | Genera seeds settimanali |
| `POST /brands/:slug/weekly-plan/produce` | Produce i post dai seeds |
| `POST /brands/:slug/weekly-plan/render` | Batch render immagini |
| `POST /brands/:slug/posts/:id/render` | Render immagine singola |
| `POST /brands/:slug/posts/:id/media` (azioni con render) | Regenerate/slide/video |
| `POST /brands/:slug/brands/[slug]/tick` | Tick manuale autopilot |
| `POST /brands/:slug/seo` | Audit/piano/initiative/asset/article |
| `POST /brands/:slug/geo` | Audit/fix GEO |
| `POST /brands/:slug/keywords` | Rigenera keyword research |
| `POST /brands/:slug/backlinks` | Rigenera opportunità backlink |
| `POST /brands/:slug/studio/competitors/research` | Ricerca competitor AI |
| `POST /brands/:slug/studio/people` (kind `ai`) | Ritratti AI |
| `POST /brands/:slug/ads/remix` | Remix brief da ad competitor |
| `POST /brands/:slug/rubrics/propose` | Batch rubriche AI |
| `POST /brands/:slug/web` (generate/optimize) | Articoli blog AI |

## Convenzioni di risposta

- Successo: `200` (o `201` per creazione key), quasi sempre con `{"ok": true, …}`.
- Errore applicativo: body `{"error": "<messaggio>"}` con status 4xx/5xx. I messaggi sono stringhe stabili
  (es. `post_not_found`, `unknown_action`, `no_credits`) su cui i client possono fare match.
- Le risposte che includono dati AI (piani, strategie, review, captions) sono **dinamiche**: i campi
  sono stabili, i valori no.
- I POST con `action` usano `{"error":"Unknown action: <x>"}` per azioni non riconosciute.

## Timezone e date

- `scheduled_for` accettato senza offset viene interpretato nel **timezone del brand**; con `Z`/`±hh:mm` viene rispettato.
- Le risposte usano ISO 8601 UTC.

## Pagine del reference

| Pagina | Area |
|---|---|
| [02 — Brand core](02-brands-core.md) | `brands`, detail, analytics, calendar, bio, publishing, tick |
| [03 — Posts](03-posts.md) | Lista, edit, approve, publish, reschedule, render, media, revoke |
| [04 — Studio](04-studio.md) | Kit, colors, memory, people, documents, competitors, history sync |
| [05 — Editorial plan](05-editorial-plan.md) | Propose, approve, discard, revise, update, save-brief, replan-week |
| [06 — Weekly plan](06-weekly-plan.md) | Plan, produce, render, save |
| [07 — Growth: SEO/GEO/web](07-growth-seo-geo.md) | SEO, GEO, keywords, backlinks, web, articles, GSC, ranks, library, video review |
| [08 — Ads, voice, GTM e gestione](08-ads-voice-gtm-misc.md) | Ads, remix, voice, GTM, rubrics, products, api-keys |

## Note

- Gli endpoint **cron** (`/tick`, `/work`) protetti da `CRON_SECRET` non fanno parte della API pubblica
  e sono documentati nelle rispettive doc di feature.
- `GET /api/v1/brands/:slug/strategy-lab` esiste ma è dev-only, senza auth — non documentato qui.
- I comandi CLI che consumano questi endpoint sono in `cli/` (fonte unica di CLI, MCP e skill).
