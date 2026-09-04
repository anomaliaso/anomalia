# API — 14 · Impostazioni: i lavori ricorrenti

Due endpoint sotto `/api/v1/brands/:slug/settings/automations`, cioè i tool MCP
`get_automations` e `set_automation`. Sono l'interruttore che la pagina `/agents` mostra nel
browser, per tutti e nove i lavori del roster — non solo per l'autopilot.

Errori comuni di auth: vedi [01-overview](01-overview.md).

## I nove lavori

`ROSTER_JOBS` (`src/lib/server/job-roster.ts`): `autopilot`, `analytics_review`, `weekly_recap`,
`seo`, `geo`, `radar_recap`, `market_refs`, `strategy_review`, `library`. Il testo di cosa fa
ciascuno arriva da `jobBlurb`, che è la stessa fonte del prompt di onboarding: un lavoro nuovo
entra da solo in tutti e due.

Lo stato è salvato come **rifiuto**, non come booleano: `brand_job_optouts` ha una riga solo per i
lavori spenti. Nessuna migration qui.

## Accendere è una decisione di spesa

È la cosa che questi due endpoint devono dire più forte di ogni altra.

Un lavoro acceso gira **da solo**, alla sua cadenza, e ogni giro chiama modelli AI e spende i
crediti del brand — senza che nessuno lo riguardi. Non c'è nessuna schermata di pagamento a fare
da testimone, e questo lo rende meno visibile di un acquisto, non meno costoso. La `description`
di `set_automation` lo dichiara, e un test tiene lì quella frase.

Spegnere invece non spende niente, vale dal tick successivo e non distrugge nulla: è la direzione
che protegge, e resta facile.

`destructive` è `false` — non si distrugge niente — e **`openWorld` non è impostato**. In questo
registry `openWorld` vuol dire "esce su internet" (`diagnose_radar`, `research_competitors`,
`sync_history`): usarlo per dire "costa" sarebbe un'annotazione che mente su cosa il tool fa. La
spesa la dicono la descrizione e la risposta, non un flag preso in prestito.

## `GET /api/v1/brands/:slug/settings/automations`

Sola lettura: nessun modello, nessun credito.

```json
{
  "brand": "demo",
  "plan": "pro",
  "scheduled_work_allowed": true,
  "jobs": [
    {
      "job": "seo",
      "what": "SEO agent — weekly site review: grade, issues, and growth initiatives.",
      "cadence": "weekly",
      "enabled": true,
      "state": "ok",
      "reason": null,
      "last_run_at": "2026-09-01T04:12:00.000Z",
      "behind": false,
      "runs_30d": 4
    }
  ]
}
```

`scheduled_work_allowed` è `scheduledWorkAllowed(plan)`: senza piano a pagamento nessuno di questi
parte, per quanti se ne accendano, e ogni tick registra `skipped/no_plan`.

## Il costo per lavoro non esiste, e il tool lo dice

`get_automations` **non** riporta dollari per lavoro. Non è una dimenticanza:

- `ai_calls` non ha nessuna colonna che nomini il loop. Le colonne sono `label`, `provider`,
  `model`, `cost_usd`, `context`, `brand_id`, `thread_id`… e `context` è testo libero per call
  site (`'design/compose'`, `'produce-agent'`, `'tool=…'`), mai una chiave del roster.
- Le `label` sono **condivise fra lavori**: `director` / `directorRewrite` stanno sia in
  `autopilot` sia in `radar_recap`; `createSingleContent` sta sia in `autopilot` sia nella
  creazione manuale di un post dal browser. Una ricostruzione `CASE WHEN label IN (…)`
  attribuirebbe male, non attribuirebbe.
- `strategy_review` non è isolabile affatto: gira come un normale turno di chat nel thread
  dell'agente proprietario, indistinguibile da un turno digitato da una persona.
- `loop_ticks` è l'unica tabella che nomina il loop per brand, e non ha né costo né una chiave di
  join verso `ai_calls`. Un join per finestra temporale sarebbe un'approssimazione, non
  un'attribuzione.

Quindi il tool porta `runs_30d` — **quante volte il lavoro ha davvero girato** — che è il dato che
esiste. I giri fermati da un gate (`skipped`) non contano: non hanno chiamato nessun modello, e
contarli direbbe "questo ti costa" di qualcosa che non è costato. Un giro `failed` invece conta,
perché può aver già speso prima di fallire.

Per avere un costo per lavoro servirebbe una colonna `loop` su `ai_calls`, scritta da ogni call
site dentro il percorso di ogni tick. È una migration più un'instrumentazione diffusa: una
decisione, non un dettaglio di questo endpoint.

## `PUT /api/v1/brands/:slug/settings/automations`

**Body**: `{ "job": "seo", "enabled": true }` — entrambi obbligatori. `enabled` non ha default:
accendere e spegnere devono essere due gesti espliciti.

**Response** `200`:

```json
{
  "ok": true,
  "job": "seo",
  "enabled": true,
  "cadence": "weekly",
  "spends_on_every_run": true,
  "scheduled_work_allowed": true
}
```

`spends_on_every_run` ripete nella risposta ciò che è stato impegnato: resta scritto nel turno
dell'agente, non solo nella descrizione che ha letto prima di chiamare.

**Errori**

| status | error | quando |
|---|---|---|
| `400` | `invalid_input` | `job` fuori dai nove, `enabled` mancante, campo non dichiarato |
| `403` | `API key is read-only` | chiave senza scope `write` |
| `500` | `toggle_failed` | la scrittura su `brand_job_optouts` è fallita (spesso: migration non applicata) |
