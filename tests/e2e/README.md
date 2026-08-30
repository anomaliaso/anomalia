# E2E smoke suite

`npm run test:e2e` runs this directory with Playwright (Chromium only). The suite is
deterministic by construction: it boots `vite dev` with **placeholder** Supabase env
(`PUBLIC_SUPABASE_URL=http://localhost:54321`, placeholder anon key — see
`playwright.config.ts`) and only visits pages that answer without any external service.

## Il file che fa eccezione

`onboarding.real.spec.ts` è l'unico che vuole un database vero, con l'utente `test@anomalia.so` e il
brand `demo` già seminati. Gira SOLO con `E2E_REAL_STACK=1`; senza, si salta. Non si protegge con
`PUBLIC_SUPABASE_URL`: quella la mette `playwright.config.ts` come segnaposto, c'è sempre, e una
guardia che non può scattare è una guardia che non esiste.

## What is covered

| Target | Assertion style |
| --- | --- |
| `/` landing | 200 + structural (`h1`, `header.nav`), never marketing copy |
| `/changelog` | 200 + entry list has items (entries are in-code) |
| `/login` | 200 + form wiring (`action="?/login"`, named inputs, OAuth forms) |
| unknown route | 404 status + error-page card echoes the code |
| `/app`, `/app/[brand]` unauthenticated | 303 → `/login` via HTTP headers |
| `/robots.txt`, `/sitemap.xml` | 200 + stable document markers |

## What is deliberately excluded

- **Any `/app/[brand]` page content** and the API under `/api/v1/**`: those read Postgres
  (brands, posts, plans…). Testing them needs a seeded database or a mocked Supabase — that
  is integration/domain territory (see the durability scenarios in `scripts/eval/`), not a
  clone-and-run smoke tier. There is no db-free `/health` endpoint to assert either.
- **Real authentication**: the redirect tests stop at the destination URL; nothing logs in.
- **Copy assertions**: waitlist-flag fallback changes landing CTAs when the DB is absent;
  headings are i18n'd. Structure only.

## Running

```bash
npm run test:e2e                 # starts its own dev server on :4173
E2E_BASE_URL=http://host:port npx playwright test   # against an already-running instance
```

In CI (`.github/workflows/ci.yml`) retries are 1 with trace on first retry; locally 0 so
flakiness surfaces immediately.
