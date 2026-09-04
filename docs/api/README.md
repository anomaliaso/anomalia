# Anomalia — API Reference (pubblica)

Reference completa della REST API pubblica di Anomalia, **generata dal codice** il 13/08/2026
(`src/routes/api/v1/`). Copre tutti gli endpoint consumati dalla CLI (`anomalia-cli`) e dalle
integrazioni esterne via API key — request, response, query params, body, errori e snippet curl.

## Indice

| Pagina | Endpoint |
|---|---|
| [01 — Overview](01-overview.md) | Auth (JWT/API key), errori comuni, gate crediti, convenzioni |
| [02 — Brand core](02-brands-core.md) | `GET /brands`, `GET /brands/:slug`, `/analytics`, `/calendar`, `/bio`, `/publishing`, `/tick`, `/doctor`, `/goals` |
| [03 — Posts](03-posts.md) | `/posts` (list/edit/delete), `/approve`, `/publish`, `/reschedule`, `/render`, `/media`, `/revoke`, `/approve-all` |
| [04 — Studio](04-studio.md) | `/studio`, `/kit`, `/colors`, `/memory`, `/people`, `/documents`, `/competitors`, `/history/sync`, `/people/:id` |
| [05 — Editorial plan](05-editorial-plan.md) | `/editorial-plan` + `propose` `approve` `discard` `revise` `update` `save-brief` `replan-week` |
| [06 — Weekly plan](06-weekly-plan.md) | `/weekly-plan` + `plan` `produce` `render` `save` |
| [07 — Growth: SEO/GEO/web](07-growth-seo-geo.md) | `/seo`, `/geo`, `/web/audits`, `/web/fixes`, `/keywords`, `/backlinks`, `/web`, `/articles`, `/gsc`, `/ranks`, `/library/scan` |
| [08 — Ads, voice, GTM e gestione](08-ads-voice-gtm-misc.md) | `/ads`, `/ads/remix`, `/voice`, `/gtm`, `/rubrics`, `/products`, `/api-keys`, `/ideas`, `/market/field`, `/radar/diagnose` |
| [09 — Connections](09-connections.md) | `/connections`, `/connections/catalog`, `/connections/:id/complete`, `/connections/:id` |
| [10 — Shares](10-shares.md) | `/shares`, `/shares/revoke`, e la rotta pubblica `/share/:token` |
| [11 — Billing](11-billing.md) | `/billing/portal`, `/billing/checkout` — link Stripe che l'agente consegna all'umano |
| [12 — Impostazioni: modelli media](12-settings-models.md) | `/settings/models` — quale modello disegna e quale gira, per brand |

## Regole di manutenzione

- Ogni endpoint nuovo o modificato **deve** aggiornare la pagina corrispondente (stessa PR).
- Le pagine riflettono il codice, non l'intento: status, body e messaggi di errore vanno copiati dal codice.
- Gli endpoint cron (`/tick`, `/work` protetti da `CRON_SECRET`) non sono API pubblica e vivono nelle doc di feature.
- Se un endpoint cambia auth (es. nuovo `gateAiAction`), aggiornare anche la tabella "Azioni a consumo crediti" in [01](01-overview.md).

## Fuori da questa reference

| Superficie | Dove |
|---|---|
| Endpoint cron (CRON_SECRET) | Doc di feature (es. 10-geo-audit, 13-radar, 19-weekly-recap) |
| API tools pubbliche del sito (`/api/tools/*`) | Sito marketing — non ancora documentate |
| Chat web (`/api/v1/chat/*`, session auth) | 24-chat-optimization |
| Beacon anonimi (`/blog/hit`, `/links/hit`) | 27-site-crawl, specs 31-p3 |
