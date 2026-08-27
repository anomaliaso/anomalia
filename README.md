# Anomalia

Social media autopilot: editorial planning, AI content generation, scheduling,
and multi-brand workspaces. This repository is the open-source, self-hostable
distribution of the app.

## Prerequisites

- Node.js 22+
- Docker with Compose
- A Supabase database: either the bundled stack (`infra/compose`) or any hosted project

## Quickstart

```sh
cp .env.example .env
npm install

cd infra/compose
cp .env.example .env
docker compose up -d --wait
cd ../..

npm run db:migrate
npm run db:seed
```

Point `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in `.env` at your
Supabase instance (skip the compose step if you use a hosted one). `db:seed`
prints the `TENANT_BRAND_ID` line to paste into `.env`.

Run it:

```sh
npm run dev                 # development, http://localhost:5173
npm run build:node && npm start   # production build, port 3000
```

or, from `infra/compose/`, bring up the prebuilt app service next to the stack:
`docker compose up -d --build app`.

## Environment notes

- `BILLING_PROVIDER=open` removes all credit and quota gating (self-hosted default).
- Social publishing runs through the publisher seam: `SOCIAL_PUBLISHER`,
  `ZERNIO_BASE_URL` and `ZERNIO_API_KEY`. Without a publisher key, approved
  posts stay approved and are not sent anywhere.
- Every AI provider reads its key from env and degrades loudly to "off" when
  the key is missing. See `.env.example` for the full list.

Read [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for the complete guide:
what degrades on purpose, cron setup, production-build caveats, and security
notes before exposing the app publicly.
