# API — 09 · Connections (app esterne)

Endpoint per collegare al brand le app esterne che alimentano il corpus (Drive, Notion, GitHub,
Gmail) e i toolkit che l'agente può chiamare come strumenti. Sono gli endpoint consumati da
`anomalia connections` e dai tool MCP `list_connections` / `connect_app` / `complete_connection` /
`revoke_connection`.

Il broker è **Composio**: le credenziali restano da loro, l'app conserva solo l'id del connected
account. Nessun token attraversa questi endpoint. Errori comuni di auth: vedi
[01-overview](01-overview.md).

Prerequisito d'ambiente: `COMPOSIO_API_KEY`. Senza, `POST /connections` risponde `503`.

## `GET /api/v1/brands/:slug/connections`

App collegate al brand. Prima di rispondere riconcilia le righe con lo stato reale presso
Composio, così una connessione revocata dal provider o creata da un'altra superficie (browser,
CLI) non resta disallineata.

**Response** `200`:

```json
{
  "connections": [
    {
      "id": "9f0c…",
      "provider": "NOTION",
      "display_name": "Notion",
      "status": "connected",
      "last_error": null,
      "connected_at": "2026-08-19T10:00:00Z",
      "created_at": "2026-08-19T10:00:00Z"
    }
  ]
}
```

`status`: `pending` (autorizzazione in corso) · `connected` · `error` (da ricollegare) ·
`revoked`.

## `GET /api/v1/brands/:slug/connections/catalog?query=`

App collegabili, con `connected` già risolto. `query` filtra per nome o slug.

**Response** `200`:

```json
{
  "apps": [
    {
      "provider": "GOOGLEDRIVE",
      "name": "Google Drive",
      "logo": null,
      "connected": true,
      "managed_auth": true,
      "category": "knowledge"
    }
  ]
}
```

`managed_auth: true` = Composio ci mette la sua OAuth app, nessuna registrazione da parte nostra.
`category`: `knowledge` (ingestita nel corpus) o `tools` (solo strumenti per l'agente).

## `POST /api/v1/brands/:slug/connections`

Avvia il collegamento. **Body**: `{ "provider": "NOTION", "display_name": "Notion" }`
(`toolkit` è accettato come alias di `provider`).

**Response** `200`:

```json
{ "connection_id": "9f0c…", "authorization_url": "https://backend.composio.dev/…" }
```

`authorization_url` è la Connect Link ospitata da Composio: va aperta dall'utente. È `null`
quando il toolkit non richiede consenso. La riga nasce in stato `pending`: il callback OAuth
atterra nel browser dell'utente, mai sul nostro server, quindi il client interroga `/complete`.

## `POST /api/v1/brands/:slug/connections/:id/complete`

Verifica se l'utente ha completato l'autorizzazione e, in quel caso, attiva la connessione (e
mette in coda il primo sync per le app di knowledge). **Idempotente e pensato per il polling.**

**Response** `200`: `{ "connection": { …stessa forma di GET… } }` — con `status` ancora `pending`
finché Composio non riporta l'account come attivo.

## `DELETE /api/v1/brands/:slug/connections/:id`

Revoca la connessione presso il provider, elimina il connected account su Composio e marca la
riga come disconnessa. Per un'app di knowledge disconnette anche la sorgente.

**Response** `200`: `{ "ok": true }`

**Errori specifici**

| Status | Body |
|---|---|
| `404` | `{"error":"Connection not found"}` |
| `503` | `{"error":"Connectors are not configured on this environment"}` |

**Esempio**

```bash
curl -s -X POST "https://anomalia.so/api/v1/brands/mio-brand/connections" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"provider":"NOTION"}'
```

---

## Webhook del brand (eventi verso un dominio del cliente)

Composio consegna **tutti** i trigger a un solo URL per progetto — il nostro. Il fan-out verso
l'endpoint del brand lo fa l'app: verifica la firma di Composio in ingresso, poi consegna con una
firma propria, retry e log.

```
GitHub → Composio → POST /api/v1/composio/webhook   (firma Composio, uno per progetto)
                         ↓ metadata.user_id = brand_<uuid> → brand
                    POST https://dominio-del-cliente/...  (firma nostra, retry, log)
```

### `GET /api/v1/brands/:slug/webhook`

```json
{
  "webhook": {
    "url": "https://esempio.com/webhooks/anomalia",
    "events": [],
    "status": "active",
    "failure_count": 0,
    "last_delivery_at": "2026-08-20T09:00:00Z",
    "last_error": null
  },
  "triggers": [
    { "trigger": "GITHUB_PULL_REQUEST_EVENT", "provider": "GITHUB", "config": { "owner": "acme", "repo": "site" } }
  ],
  "deliveries": [{ "id": "…", "trigger_slug": "…", "status": "delivered", "attempts": 1 }]
}
```

`events` vuoto significa "tutti gli eventi del brand". `status`: `active` · `failing` ·
`paused` (sospeso dopo 20 fallimenti consecutivi).

### `PUT /api/v1/brands/:slug/webhook`

**Body**: `{ "url": "https://…", "events": ["GITHUB_PULL_REQUEST_EVENT"], "rotate_secret": false }`

L'URL deve essere **https** e pubblico: loopback e reti private vengono rifiutati (`400`). Il
`secret` di firma è restituito **solo** alla creazione o con `rotate_secret: true` — dopo non è
più leggibile. Salvare l'endpoint crea anche i trigger che lo stato del brand implica (una
`GITHUB_PULL_REQUEST_EVENT` per repository seguito).

### `DELETE /api/v1/brands/:slug/webhook`

Rimuove l'endpoint e cancella su Composio i trigger che esistevano solo per alimentarlo.

### Consegna

Ogni POST verso il brand porta:

| Header | Contenuto |
|---|---|
| `anomalia-delivery-id` | id della consegna, stabile tra i retry |
| `anomalia-event-type` | slug del trigger, es. `GITHUB_PULL_REQUEST_EVENT` |
| `anomalia-timestamp` | ISO 8601 |
| `anomalia-signature` | `v1,<base64>` — `HMAC-SHA256` di `{delivery-id}.{timestamp}.{body}` col secret |

Body: `{ "id", "type", "created_at", "data" }`, dove `data` è il payload del trigger.

Qualsiasi 2xx è successo. Altrimenti si riprova fino a 6 volte con backoff 30s → 2m → 8m → 32m →
2h → 6h (`/api/v1/webhooks/work`, cron ogni 10 minuti). Dopo 20 fallimenti consecutivi
l'endpoint passa in `paused` e smette di consumare retry finché non lo si risalva.

Prerequisito d'ambiente: `COMPOSIO_WEBHOOK_SECRET` (subscription webhook creata nella dashboard
Composio e puntata su `/api/v1/composio/webhook`). Senza, l'ingresso risponde `503`.
