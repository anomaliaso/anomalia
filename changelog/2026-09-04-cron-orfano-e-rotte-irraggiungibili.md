# Un cron che chiamava una rotta inesistente, e due rotte che nessuno raggiunge

## Cosa spariva

- **`/api/v1/billing/reconcile/tick`** — cron giornaliero (`0 3 * * *`) in `vercel.json`
  **e** in `docker/cron/sidecar.mjs`. `src/routes/api/v1/billing/` non esiste: sotto
  `api/v1` non c'e' nessuna cartella `billing` (le uniche rotte billing stanno sotto
  `brands/[slug]/billing/{checkout,portal}`, altra cosa). Ogni notte una richiesta a un
  404, su due piattaforme.
- **`src/routes/app/onboarding/generating/`** — il `+page.server.ts` fa
  `throw redirect(303, '/app')` incondizionatamente, col commento «Legacy … — retired».
  Le 232 righe di `+page.svelte` non possono renderizzare in nessun caso. Zero link,
  zero `goto`, zero riferimenti nel repo.
- **`src/routes/api/v1/brands/[slug]/strategy-lab/`** + `scripts/run-strategy-lab.mjs` —
  la rotta lo dice da sola: «Meant to be hit N times by scripts/run-strategy-lab.mjs …
  Delete this route when done tuning». Lo script e' l'unico chiamante e non e' mai
  citato da niente; la coppia vive o muore insieme. Via anche la riga di
  `docs/api/01-overview.md` che la annunciava.

## Come ho provato che erano morti

- Ho incrociato le due liste di cron (`vercel.json`, `docker/cron/sidecar.mjs`) con
  l'esistenza di `src/routes/<path>/+server.ts`: `billing/reconcile/tick` e' l'unico
  path senza rotta, in entrambe.
- Nella direzione opposta — rotte a forma di job (`*/tick`, `*/work`, `*/sweep`,
  `*/recap`, `*/sync`, …) non schedulate da nessuno — le tre trovate sono tutte vive:
  `brands/[slug]/tick` e `studio/history/sync` sono chiamate da `cli/lib/api.ts`,
  `onboarding/social-history/work` e' un worker auto-invocato da
  `social-history-work.ts`.
- `git grep` su `onboarding/generating` e `strategy-lab`: zero occorrenze fuori dai
  file cancellati (per strategy-lab, solo la riga di docs che se ne va con loro).

## Una deriva segnalata, non corretta

`docker/cron/sidecar.mjs` e `vercel.json` non hanno la stessa lista: il sidecar schedula
`/api/v1/market/harvest` e `/api/v1/market/trends` che su Vercel non girano, e non
schedula `/api/v1/chat/models/sync` che su Vercel gira. Le tre rotte **esistono** tutte,
quindi non e' codice morto: e' una scelta (o una dimenticanza) su cosa gira in
self-host. Allinearle cambierebbe il comportamento, e questa PR cancella soltanto.
