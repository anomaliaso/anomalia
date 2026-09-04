# API — 15 · Impostazioni: le fonti del Radar

Quattro endpoint sotto `/api/v1/brands/:slug/settings/radar`, cioè i tool MCP `get_radar`,
`set_radar_platform`, `add_radar_source` e `remove_radar_source`.

Errori comuni di auth: vedi [01-overview](01-overview.md).

## Dove è salvato cosa

| cosa | dove |
|---|---|
| interruttori delle piattaforme | `brands.content_prefs.radar.platforms` |
| fonti | `brand_news_sources` (`kind`, `value`, `lang`, `active`), unico su `(brand_id, kind, value)` |

Nessuna migration: sono la colonna e la tabella che la pagina Settings → Radar scrive già.

## Il piano decide, e la lettura lo dice prima

`threads`, `x` e `linkedin` (piattaforme) e `threads_query`, `x_community`, `linkedin_query`
(tipi di fonte) appartengono al piano **Pro** (`hasProRadarLeads`). Sotto, `get_radar` li segna
`plan_locked` e i due write rispondono `plan_required` (403).

Il numero di fonti ha un tetto per piano (`radarSourceLimit`): `get_radar` porta `source_limit` e
`sources_used`, e `add_radar_source` risponde `source_limit` (403) nominando il tetto.

Sono le due cose che un agente non può indovinare, ed è la ragione per cui la lettura esiste.

## `GET /api/v1/brands/:slug/settings/radar`

```json
{
  "brand": "demo",
  "plan": "starter",
  "platforms": [{ "platform": "threads", "enabled": false, "plan_locked": true }],
  "sources": [{ "id": "…", "kind": "subreddit", "value": "coffee", "lang": "auto", "active": true }],
  "allowed_kinds": ["gnews_query", "rss", "subreddit", "reddit_query"],
  "source_limit": 10,
  "sources_used": 1
}
```

## `PUT /api/v1/brands/:slug/settings/radar`

**Body**: `{ "platform": "reddit", "enabled": true }`. Spegnere restringe cosa il Radar trova; non
cancella nessuna fonte e nessun risultato già trovato.

Errori: `invalid_input` (400), `plan_required` (403), `update_failed` (500).

## `POST /api/v1/brands/:slug/settings/radar/sources`

**Body**: `{ "kind": "subreddit", "value": "r/coffee", "lang": "it" }` — `lang` facoltativo
(`auto` di default).

Una fonte che c'è già **non** è un errore: niente cambia e `added: false` lo dice. È
deliberatamente diverso da un 409: un agente che riprova dopo un timeout non deve vedere un
fallimento per una cosa che è nello stato giusto.

Errori: `invalid_input` (400), `invalid_value` (400 — un `rss` che non è una URL, o un valore
vuoto dopo la normalizzazione), `plan_required` (403), `source_limit` (403), `insert_failed` (500).

## `POST /api/v1/brands/:slug/settings/radar/sources/remove`

**Body**: `{ "kind": "subreddit", "value": "r/coffee" }`.

È un `POST` e non un `DELETE` per una ragione precisa: la fonte si nomina con la coppia
`(kind, value)` — la stessa chiave unica che l'ha creata, e l'unica cosa che un agente ha in mano
subito dopo averla aggiunta — e il client generato dal registry non manda un corpo su `DELETE`.
Nessun id da ricordare, nessun giro di rete per scoprirlo.

Una coppia che non esiste risponde `not_found` (404), non un successo che non ha tolto niente.

`destructive: true`: è l'unico dei quattro.

## La normalizzazione che le due strade devono condividere

Un subreddit si scrive `r/coffee` e si conserva `coffee`. Normalizzarlo solo in aggiunta
lascerebbe una rimozione per `r/coffee` senza corrispondenza: la fonte resterebbe lì mentre la
risposta dice che è stata tolta.

`radarSourceValue(kind, value)` (`src/lib/server/radar.ts`) è quel passaggio, e lo chiamano tutti
e tre i punti che scrivono: l'aggiunta, la rimozione e l'azione del form del browser. La pagina
teneva anche un elenco dei tipi validi ricopiato a mano — la quarta copia — ora sostituito da
`RADAR_BASE_KINDS + RADAR_PRO_LEAD_KINDS`.
