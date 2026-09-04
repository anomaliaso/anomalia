# API — 10 · Shares (viste pubbliche per il cliente)

Endpoint per consegnare a un cliente **un link a una vista sola**, senza dargli un account.
Sono gli endpoint dietro i tool MCP `create_share` / `list_shares` / `revoke_share`.

Il link non è una sessione ridotta: è uno **snapshot congelato**. Alla creazione l'app copia,
campo per campo, i soli campi dichiarati per quella vista dentro `shared_views.snapshot`. La
rotta pubblica legge quella riga e nient'altro — non torna mai su `posts`, `brands` o su una
qualunque tabella viva. Una colonna aggiunta domani non può uscire da un link di ieri.

Il token è casuale (32 byte, base64url) e **viene mostrato una volta sola**: nel database resta
solo il suo sha256. Un link non salvato non si recupera: si revoca e se ne crea un altro.

> **Prerequisito di schema.** Questi endpoint richiedono la tabella `shared_views`
> (`supabase/migrations/20260904120000_shared_views.sql`). I deploy di questo repo non applicano
> le migration: finché non la applica una persona, i tre endpoint rispondono `500` con
> `{"error":"shares_not_migrated"}` e il nome del file da applicare in `details`.

Nessuno di questi endpoint consuma crediti AI: non c'è nessuna chiamata al modello.
Errori comuni di auth: vedi [01-overview](01-overview.md).

## `POST /api/v1/brands/:slug/shares`

Crea il link. Richiede una API key con scope `write`.

**Body**:

```json
{ "view": "calendar", "month": "2026-09", "expires_in_days": 30 }
```

| Campo | Obbligatorio | Note |
|---|---|---|
| `view` | sì | `calendar`, `dashboard` o `monthly_report` |
| `month` | no | `YYYY-MM`. Senza, il mese corrente sull'orologio del brand |
| `expires_in_days` | no | 1–365. Senza, il link vale finché non viene revocato |

Un campo non dichiarato fa `400 invalid_input`: il body è `.strict()`.

**Response** `200`:

```json
{
  "ok": true,
  "id": "9f0c…",
  "view": "calendar",
  "month": "2026-09",
  "url": "https://anomalia.so/share/x7Qd…",
  "token": "x7Qd…",
  "expires_at": "2026-10-04T09:00:00.000Z"
}
```

`token` compare **solo qui**. Non è recuperabile da `GET /shares`, né da nessun'altra parte.

**Errori**: `400 invalid_input` · `500 shares_not_migrated`.

## `GET /api/v1/brands/:slug/shares`

I link creati per questo brand, dal più recente, con il loro stato. Nessun token e nessuna
impronta di token compaiono nella risposta.

**Response** `200`:

```json
{
  "shares": [
    {
      "id": "9f0c…",
      "view": "calendar",
      "month": "2026-09",
      "status": "live",
      "created_at": "2026-09-04T09:00:00.000Z",
      "expires_at": null,
      "revoked_at": null
    }
  ]
}
```

`status`: `live` · `revoked` · `expired`.

**Errori**: `500 shares_not_migrated`.

## `POST /api/v1/brands/:slug/shares/revoke`

Spegne un link. Richiede una API key con scope `write`.

L'id sta nel body e non nel path apposta: il registry dei contratti (`packages/api-contracts`)
non risolve ancora un segmento `:id`, e un endpoint scritto a mano perderebbe il tool MCP che il
registry genera da solo.

**Body**: `{ "id": "9f0c…" }`

**Response** `200`: `{ "ok": true, "id": "9f0c…", "revoked_at": "2026-09-04T10:00:00.000Z" }`

**Errori**: `400 invalid_input` · `404 share_not_found` (anche quando la share esiste ma è di un
altro brand) · `500 shares_not_migrated`.

Revocare non tocca l'appartenenza al brand: non toglie nessuno da nessuna parte.

## `GET /share/:token` — la rotta pubblica

Non è sotto `/api/v1/brands/:slug` e non sta nel registry: non è un endpoint di brand. Non
chiede autenticazione, non legge la sessione e non ha uno slug nel path — dall'URL non si ricava
né quale brand né quale account ci sia dietro.

Legge con la chiave di servizio, con l'impronta del token come unica chiave; ad `anon` la tabella
resta revocata, così nemmeno una policy scritta male in futuro può aprirla.

| Caso | Risposta |
|---|---|
| Token valido | `200` con la pagina della vista |
| Token revocato | `404` |
| Token scaduto | `404` |
| Token mai esistito | `404` |

Le tre risposte sono **identiche**: nessuna conferma che il brand esista, che il link sia mai
esistito o che sia stato revocato. Una tabella `shared_views` assente è invece un `500`, perché
è un guasto del server e non una risposta sul link.

## Cosa esce e cosa no

L'allowlist è nel codice, in `src/lib/server/shared-views.ts`, e un test verifica l'insieme
esatto delle chiavi: un campo aggiunto a monte fa fallire il test invece di uscire dal link.

**`calendar`** — `brand_name`, `timezone`, `month`, `month_label`, `posts[]`.
Ogni post: `platform`, `caption`, `media_url`, `scheduled_for`, `slot`, `status`.
`status` è `planned` o `published`: il workflow interno (`pending_user`, `approved`, `failed`)
non esce. Le bozze senza data restano fuori.

**`dashboard`** — `brand_name`, `timezone`, `month`, `month_label`, `published`, `planned`,
`reach`, `upcoming[]`.
Ogni uscita ha le stesse chiavi di un post del calendario. È il calendario e il report messi
insieme: le tre cifre del mese e le prossime sei uscite non ancora pubblicate. Si compone dei due
builder che esistono già, quindi non ha una terza allowlist da tenere allineata.

**`monthly_report`** — `brand_name`, `timezone`, `month`, `month_label`, `published`, `totals`,
`platforms[]`, `top_posts[]`.
Ogni top post: `platform`, `caption`, `thumbnail_url`, `url`, `published_at`, `views`, `likes`,
`comments`, `shares`.

Non escono mai: id di post, brand o riga; prompt e `image_prompt`; `qc`, `needs_attention`,
`attention_reason`; token di approvazione; connettori, note interne, costi, impostazioni, membri;
lo slug del brand e la provenienza dei dati.

## Fuori da questa versione

L'export PDF, le viste di tipo `proposal` e il calendario **dal vivo** non ci sono. La versione
uno è fatta di snapshot revocabili: il vivo arriva dopo, quando privacy e cache saranno provate.
