# API — 10 · Billing (link di pagamento per gli agenti)

Due endpoint che **mintano una URL Stripe e la restituiscono**. Sono i tool MCP
`create_billing_portal_link` e `create_checkout_link`, e nascono da una richiesta precisa: un
agente esterno deve poter *avviare* un pagamento e passare il link all'umano.

Il confine di sicurezza è nel codice, non solo nella descrizione: **l'agente non paga e non
cambia mai un piano.** Ottiene una URL; chi la apre e completa l'azione sulla pagina ospitata da
Stripe è la persona. Nessuno dei due endpoint addebita una carta, cambia un abbonamento, applica
un coupon o disdice qualcosa — `applyRetentionCoupon`, `cancelSubscriptionAtPeriodEnd` e
`ensureSubscriptionCanceled` non sono raggiungibili da qui, e un test lo verifica.

## La URL è una credenziale

Una URL del portale (o del checkout) Stripe dà accesso alla fatturazione di quel cliente a
**chiunque la possieda**, senza altra autenticazione. Quindi: non viene mai loggata, non viene
mai salvata, e compare **una sola volta** nella risposta. Chi la riceve la consegna al
proprietario dell'account e non ne tiene copia.

## Fatturazione dell'org, registry di brand

Il registry degli endpoint (`packages/api-contracts`) è scoped sul brand
(`/api/v1/brands/:slug/…`), mentre la fatturazione appartiene all'**organizzazione**. Questi due
endpoint stanno **dentro** il registry e risolvono l'org lato server con `orgBillingForBrand` —
la stessa funzione che legge la pagina `/app/billing`. Lo slug è solo la maniglia che l'agente
ha già in mano: ogni comando CLI/MCP è brand-scoped, e c'è **un solo posto** che decide quale
org fattura un brand.

## Chi è autorizzato

Accedere a un brand **non** è avere autorità sulla fatturazione dell'org. Sul web la guardia è
`isBrandOwner` (RLS); qui la RLS non prova niente, perché il path con API key gira come service
role. Quindi la condizione è scritta a mano: `isOrgOwner(supabase, brand.org_id, user.id)`.

Un collaboratore di un brand condiviso (0077) prende `not_org_owner` (403) — esattamente come il
browser gli risponderebbe "Owner only".

## Niente gate sui crediti

**Nessuno dei due chiama `gateAiAction` e nessuno guarda i crediti.** Sarebbe circolare: chi ha
finito i crediti è precisamente la persona che deve arrivare al checkout. Nessuno dei due chiama
un modello.

Una API key **read-only** viene comunque rifiutata (403): il link porta anche a un bottone di
disdetta.

---

## `POST /api/v1/brands/:slug/billing/portal`

Portale di fatturazione Stripe dell'org: fatture, metodo di pagamento, cambio piano, disdetta.

**Body**: nessun campo. Un campo non dichiarato viene rifiutato (`invalid_input`, 400).

**Response** `200`:

```json
{
  "ok": true,
  "url": "https://billing.stripe.com/p/session/live_xyz"
}
```

```bash
curl -sS -X POST https://anomalia.so/api/v1/brands/demo/billing/portal \
  -H "Authorization: Bearer $ANOMALIA_TOKEN" \
  -H 'content-type: application/json' -d '{}'
```

## `POST /api/v1/brands/:slug/billing/checkout`

Pagina ospitata da Stripe dove la persona sceglie un piano a pagamento e paga. Il prezzo **non è
nominato qui**: la scaletta dei prezzi vive su Stripe, e l'app non cita mai un price id.

**Body**:

| Campo | Tipo | Note |
|---|---|---|
| `plan` | string, opzionale | Chiave del piano voluto (`starter`, `pro`, …). Rifiutato se l'org non può salirci |

**Response** `200`:

```json
{
  "ok": true,
  "url": "https://billing.stripe.com/p/session/live_upgrade",
  "plans": [{ "key": "pro", "label": "Pro" }]
}
```

`plans` è la stessa scaletta del bottone di upgrade nel prodotto (`plansAbove`), Go incluso solo
mentre `FEATURE_PLAN_GO` è acceso. Serve all'agente per dire in una riga cosa vedrà la persona.

```bash
curl -sS -X POST https://anomalia.so/api/v1/brands/demo/billing/checkout \
  -H "Authorization: Bearer $ANOMALIA_TOKEN" \
  -H 'content-type: application/json' -d '{"plan":"pro"}'
```

## Errori

Ogni fallimento è dichiarato nel contratto e lo status arriva da `statusForFailure`, non da una
catena di `||`. Un guasto di Stripe è **502**: è nostro, non di chi chiama.

| `error` | Status | Endpoint | Significato |
|---|---|---|---|
| `invalid_input` | 400 | entrambi | Il body non passa lo schema (campo sconosciuto incluso) |
| `unknown_plan` | 400 | checkout | Il `plan` chiesto non è fra quelli sopra al piano attuale. La risposta porta `plans` |
| `not_org_owner` | 403 | entrambi | Il chiamante raggiunge il brand ma non possiede l'org che paga |
| `API key is read-only` | 403 | entrambi | Chiave senza scope `write` |
| `Brand not found` | 404 | entrambi | Slug inesistente o non del chiamante (`loadBrandForUser`) |
| `no_customer` | 409 | entrambi | L'org non ha mai pagato: non esiste un cliente Stripe da aprire |
| `no_subscription` | 409 | checkout | Non c'è un abbonamento da aggiornare |
| `no_org_billing` | 500 | entrambi | Non siamo riusciti a risolvere l'org che fattura il brand — nostro |
| `stripe_unavailable` | 502 | entrambi | Stripe ha risposto male — nostro, non di chi chiama |

`no_customer` e `no_subscription` non sono errori di sintassi: descrivono un account che non si è
ancora abbonato. La risposta porta `app_billing_url`, la pagina in-app da cui la persona parte —
oggi l'abbonamento nasce lì, non da questi endpoint, perché il repo non crea Checkout Session e
non nomina price id (scelta dichiarata in `src/lib/server/stripe.ts`).

Errori di auth comuni (401, 403 accesso non ancora abilitato): vedi
[01-overview](01-overview.md).
