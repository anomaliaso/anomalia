# API — 13 · Impostazioni: come lavora il brand

Due endpoint sotto `/api/v1/brands/:slug/settings/brand`, cioè i tool MCP `get_brand_settings` e
`set_brand_settings`. Coprono quattro pagine di Settings che erano quattro form separati: fuso di
pubblicazione, piattaforme bersaglio, hashtag per piattaforma, esempi di voce.

Errori comuni di auth: vedi [01-overview](01-overview.md).

## Dove è salvata ogni cosa

| campo | colonna |
|---|---|
| `timezone` | `brands.timezone` |
| `platforms` | `brands.target_platforms` (array; elenco vuoto → `null`) |
| `hashtags` | `brands.content_prefs.platformHashtags` |
| `voice_examples` | `brands.content_prefs.voiceExamples` |

Nessuna migration: sono tutte colonne che il browser scrive già.

La **lingua** dei post non è qui: vive su `content_prefs.language` e la scrive `update_brand_kit`.
Due scrittori per lo stesso campo sono una divergenza in attesa.

## `GET /api/v1/brands/:slug/settings/brand`

Sola lettura: nessun modello, nessun credito.

```json
{
  "brand": "demo",
  "timezone": "Europe/Rome",
  "platforms": ["instagram", "reddit"],
  "platform_choices": ["instagram", "tiktok", "facebook", "linkedin", "x", "threads", "youtube", "bluesky", "reddit"],
  "connected_platforms": ["instagram"],
  "hashtags": { "instagram": ["#caffe", "#milano"] },
  "voice_examples": ["Un post vero del brand."]
}
```

`connected_platforms` è la parte che non si trova altrove. `target_platforms` **non** è validata
contro gli account collegati: si può bersagliare una piattaforma dove non c'è dove pubblicare, e i
post prodotti per lei restano in `approved` con `noAccount` finché un account non esiste
(`src/lib/server/publish.ts`). Senza questo campo, un agente non ha modo di accorgersene.

## `PUT /api/v1/brands/:slug/settings/brand`

**Body** — tutti i campi facoltativi, ma almeno uno:

```json
{
  "timezone": "America/New_York",
  "platforms": ["instagram", "linkedin"],
  "hashtags": { "instagram": ["#caffe"] },
  "voice_examples": ["Un post vero del brand."]
}
```

`hashtags` e `voice_examples` **sostituiscono** l'intera lista: si manda quella completa, non una
differenza. `{}` e `[]` la cancellano. Gli hashtag passano dallo stesso ripulitore del form
(`normalizeHashtags`): un `#` solo davanti, niente spazi o punteggiatura dentro, deduplicati, tetto
a 30.

**Response** `200`:

```json
{
  "ok": true,
  "timezone": "America/New_York",
  "platforms": ["instagram", "linkedin"],
  "hashtags": { "instagram": ["#caffe"] },
  "voice_examples": ["Un post vero del brand."],
  "without_account": ["linkedin"]
}
```

**Errori**

| status | error | quando |
|---|---|---|
| `400` | `invalid_input` | una piattaforma fuori elenco, un campo non dichiarato, un tipo sbagliato |
| `400` | `no_fields` | body valido ma vuoto: non è una scrittura |
| `400` | `unknown_timezone` | stringa che `Intl` non risolve come fuso |
| `403` | `API key is read-only` | chiave senza scope `write` |
| `500` | `update_failed` | la scrittura su `brands` è fallita |

## Le due conseguenze che il tool dichiara

Sono nella `description` del tool, non solo qui: è l'unica cosa che un agente legge prima di
chiamare.

**Il fuso non sposta i post che hanno già un orario.** `posts.scheduled_for` è un `timestamptz`,
cioè un istante assoluto: la conversione da orario locale a UTC avviene **una volta**, quando la
riga viene creata o rischedulata (`wallClockToUtc` / `nextOccurrence` in
`src/lib/server/schedule.ts`). Nessuno la ricalcola dopo. Cambiare il fuso quindi non muove niente
in assoluto — muove l'**ora locale** con cui quell'istante si legge: un post fissato per le 18:00 a
Roma (16:00 UTC) diventa le 12:00 a New York. Solo le programmazioni successive usano il fuso
nuovo.

**Togliere una piattaforma non annulla i post già programmati su di essa.**
`brands.target_platforms` è un ingresso di **produzione**: lo leggono il planner
(`planner-inputs.ts`) e il produttore (`scheduler.ts`) per decidere per quali piattaforme scrivere
i post NUOVI. Il percorso di pubblicazione non la legge affatto — `publish.ts` costruisce i
bersagli dalla riga del post (`post.platforms` / `post.platform`) e l'unico cancello è l'esistenza
di un `social_accounts` attivo. Un post già programmato esce lo stesso.
