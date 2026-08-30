# Self-hosting

Run Anomalia against your own Supabase instance instead of ours. This covers the app + database;
read it alongside [`infra/compose/docker-compose.yml`](../infra/compose/docker-compose.yml)
(the Supabase stack) and the two root env files, [`.env.example`](../.env.example) (the app) and
[`infra/compose/.env.example`](../infra/compose/.env.example) (the stack).

## What you get, and what you don't

The core product works self-hosted: onboarding, content generation, planning, scheduling and the
chat agents. Three things degrade **on purpose**, loudly, instead of half-working:

- **AI providers.** Every model call reads an API key from env (`GEMINI_API_KEY`, `KIE_API_KEY`,
  `DEEPSEEK_API_KEY`, …). Without one, that provider's feature says why it's off instead of
  failing silently — see `.env.example` for the full list and what falls back to what.
- **The in-chat sandbox shell and motion-video rendering.** Both run on Vercel Sandbox
  (`@vercel/sandbox`), a Vercel-account-only Firecracker microVM service — there is no
  self-hostable equivalent shipped here. `SANDBOX_DISABLED=1` turns the feature off cleanly
  (the chat tool explains why instead of timing out). Building a local Docker-based sandbox
  provider is a real follow-up, not done in this pass — see the note in
  `infra/compose/docker-compose.yml`.
- **Connecting social accounts, publishing, post analytics and ads.** All of it goes through
  Zernio (`ZERNIO_API_KEY`, `src/lib/server/zernio.ts`) — a hosted API with no self-hostable
  alternative shipped here and no provider interface to swap for your own. Without the key you
  cannot connect an account at all, so approved posts stay `approved` and quietly never go out
  (`publish.ts` returns `noAccount` and leaves the status untouched). `GET /api/status` reports
  `social:publishing — publishing API key not set` if you want to check. Everything upstream still
  works; only the last mile is gone.

**Billing is not one of them, and not what the README used to imply.** The default provider is the
metered one that runs the hosted product: credits are counted and plans are gated unless you set
`BILLING_PROVIDER=open`. And `open` removes credit and quota metering only — the ~75 call sites
that gate a feature by reading `brands.plan` / `brands.status` directly are unaffected, and the
upsell screens still point at Stripe. `npm run db:seed` therefore creates its brand on
`plan='pro', status='active'` (override with `SEED_BRAND_PLAN` / `SEED_BRAND_STATUS`); set those to
something unpaid and connecting a social account stops working, by design.

**Production builds are supported.** `svelte.config.js` still defaults to `@sveltejs/adapter-vercel`,
so the cloud deploy is untouched; setting `DEPLOY_TARGET=node` selects `@sveltejs/adapter-node`
instead. `npm run build:node && npm run start` goes through the exact same chain as the cloud build
(`scripts/typecheck-runtime.mjs`, then Vite) and serves the compiled app on port 3000 (`PORT` to
change). Or don't build anything yourself: [`infra/app/Dockerfile`](../infra/app/Dockerfile) is a
multi-stage non-root image built from that same target (give the build stage a few GB of RAM —
the adapter re-bundles the whole server, and Node's default 4 GB heap OOMs on it), and
[`infra/compose/docker-compose.yml`](../infra/compose/docker-compose.yml) has an `app` service wired
to the stack below — from `infra/compose/`, once `docker compose up -d --wait` has brought the stack
up, `docker compose up -d --build app` starts the app on `${APP_PORT:-3000}`, pointed in-network at
Kong with the stack's own keys (set `APP_SECRET`, `GEMINI_API_KEY` and optionally `CRON_SECRET` in
`infra/compose/.env`; see its App section). What has not changed: these are real production builds,
so the cron/worker check that `npm run dev` skips on purpose is fail-closed against you too — see
"Cron" just below and "Security" at the end before you put this on a public hostname.

**Cron.** In production, Vercel Cron calls the ~45 endpoints listed under `crons` in `vercel.json`
(mostly `/tick` and `/work`) on a schedule, authenticated with `CRON_SECRET`. Self-hosted, nothing
calls them for you — wire your own scheduler (system `cron` + `curl`, a GitHub Actions schedule,
anything that can do `curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/v1/autopilot/tick`)
at whatever cadence you want. In a **production build** every handler is fail-closed: no
`CRON_SECRET` set, no cron runs. Under `npm run dev` that check is skipped by design (`if (dev)
return true` in 48 of them), so read the security note below before putting a proxy in front of it.

## One brand or many

Anomalia is built multi-tenant: a brand is the tenant, every table is scoped to one, and an agency
runs several side by side. Self-hosting for yourself, that shell is furniture you never use — a
switcher with one entry, a brands grid with one card, an invite screen for a team of one.

Set `TENANT_BRAND_ID` to a brand's UUID and it goes away:

| | with `TENANT_BRAND_ID` set |
|---|---|
| Brand switcher | not rendered — the app never asks for the other brands |
| `/app` | redirects straight to that brand instead of offering a choice |
| Settings › Team (members, invites) | 404 |
| Settings › Danger (delete brand) | 404 — deleting the only brand would brick the install |
| Onboarding | fills the brand you seeded instead of creating a second one |

**Onboarding still matters.** A seeded row is empty — no strategy, no editorial plan, no people.
The wizard is what fills it, so it is not switched off: it is pointed at the brand that already
exists. Run it once at `/app/onboarding` and it writes into that row instead of creating another,
leaving the slug alone (renaming it would change every URL to distinguish the brand from nothing).

`npm run db:seed` prints the line to paste. What it does **not** change is the database: every
table keeps its `brand_id` and every row-level-security policy stays exactly as it is. With one
brand `auth_brand_ids()` returns that one id, so `where brand_id in (…)` is already the right
answer — no migration, no downtime, and going back to many brands is deleting a line from `.env`.

**The UUID and nothing else.** The name and the slug live on the `brands` row; a copy of them in
env would be a second source of truth that drifts the day someone renames the brand, silently and
with no error anywhere. If the id points at a row that does not exist, the app says so and stops:
it never invents a brand, because an app that looks empty without explaining why is the worst of
the failure modes.

**What this is not.** It is a configuration, not a build: the multi-brand code is still in the
repo, switched off. A build that ships without it is a separate step and is not done here.

## Prerequisites

- Docker (for the Supabase stack in `infra/compose/`)
- Node.js ≥ 22, npm
- `openssl` (to generate secrets)

## Install

```bash
# 1. Stack secrets — fill POSTGRES_PASSWORD, DASHBOARD_PASSWORD, SECRET_KEY_BASE
#    (openssl rand -base64 32/48, see comments in the file). Leave JWT_SECRET as shipped: it,
#    ANON_KEY and SERVICE_ROLE_KEY are one matched set — change one alone and every service
#    answers 401 to everything.
cp infra/compose/.env.example infra/compose/.env

# 2. App env — at minimum PUBLIC_SUPABASE_URL=http://localhost:8000 and PUBLIC_SUPABASE_ANON_KEY
#    matching infra/compose/.env's ANON_KEY; add AI provider keys as you get them
cp .env.example .env

# 3. Supabase stack: Postgres + Auth + REST + Storage + Realtime + the API gateway
#    --wait is not optional: step 5 needs tables that the storage and realtime containers
#    create during their own startup.
(cd infra/compose && docker compose up -d --wait db kong auth rest realtime storage)

# 4. App dependencies
npm install

# 5. Schema — applies every supabase/migrations/*.sql file in order, tracked in
#    app_schema_migrations (the name is app-prefixed: GoTrue owns a schema_migrations of its own)
DATABASE_URL="postgres://postgres:<POSTGRES_PASSWORD from infra/compose/.env>@localhost:5432/postgres" \
  npm run db:migrate

# 6. Realtime's policies depend on a table created by the Realtime service, so
#    apply this idempotent hook after the service is healthy.
(cd infra/compose && docker compose --profile init run --rm realtime-policies)

# 7. One demo user + org + brand to log in with
DATABASE_URL="postgres://postgres:<same password>@localhost:5432/postgres" npm run db:seed

# 8. The app
npm run dev

#    `npm run dev` is the local-trial path. For a real deployment use the production build:
#    npm run build:node && npm run start
#    …or skip Node entirely and let compose build the image (see "What you get" above).
```

`db:seed` needs two more variables besides `DATABASE_URL` — `PUBLIC_SUPABASE_URL=http://localhost:8000`
and `SUPABASE_SERVICE_ROLE_KEY` (the `SERVICE_ROLE_KEY` from `infra/compose/.env`): it creates the
demo user through GoTrue's admin API, not with a hand-written insert.

`npm run db:migrate`, the Realtime policy hook and `npm run db:seed` are idempotent — re-run any of
them after pulling new migrations, for instance, without duplicating anything. If migration runs
before Realtime has created `realtime.messages`, it defers 0226 without recording it; the hook
applies and records it after the Realtime healthcheck.

If `db:migrate` stops on `0004` with `relation "storage.buckets" does not exist`, the storage
container hadn't finished creating its own tables yet (this is what `--wait` above prevents). Just
run `npm run db:migrate` again: it resumes from the first unapplied file.

Want the Supabase Studio dashboard (table editor, SQL runner) too? `docker compose --profile
studio up -d` from `infra/compose/`, then open `http://localhost:8000` with the
`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` you set.

## Required env — the app (`.env`)

`TENANT_BRAND_ID` is optional and covered in [One brand or many](#one-brand-or-many).

Everything else in `.env.example` is optional (a feature degrades or turns off without it, and
says so). These are the ones the app won't run at all without:

| Variable | Why |
|---|---|
| `PUBLIC_SUPABASE_URL` | Your Supabase project URL — `http://localhost:8000` for the compose stack above. |
| `PUBLIC_SUPABASE_ANON_KEY` | The anon/publishable key. Public by design, but must be **your** project's — never reuse a value from a repo. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only, full-table-access key. Powers every admin DB write (webhooks, cron, migrations helpers). Never send to the client. |
| `PUBLIC_APP_URL` | Your app's own origin — builds absolute links in emails and cron-sent messages, which have no browser `url.origin` to read. |
| `ORIGIN` | The origin the Node server believes it is serving (compose sets it from `PUBLIC_APP_URL`). Leave it set: without it adapter-node assumes `https`, so every form POST — sign-in included — is rejected as cross-site, and the cron's internal calls get routed to the brand-blog group and 404. The cost is that brand blogs on their own domains need a reverse proxy in front of the app. |
| `APP_SECRET` | Signs one-tap email approve links. Any long random string. |
| `GEMINI_API_KEY` | Runs onboarding's website analysis and most background AI. Nothing AI-shaped works without this one specifically. |

One more that isn't required but that you almost certainly want: `BILLING_PROVIDER=open`, which
turns off credit and quota metering. Leave it unset and your own instance, on your own API keys,
stops at the hosted product's credit ceiling.

## Required env — the stack (`infra/compose/.env`)

| Variable | Why |
|---|---|
| `POSTGRES_PASSWORD` | Every service below authenticates to Postgres with this — Auth, REST, Storage, Realtime, and you via `DATABASE_URL`. |
| `JWT_SECRET` | The symmetric key Auth signs tokens with and REST/Storage/Realtime verify them against. Shipped pre-filled and matching the two keys below — if you change it, regenerate `ANON_KEY` and `SERVICE_ROLE_KEY` in the same step or nothing authenticates. Changing it after go-live also invalidates every session. |
| `ANON_KEY` / `SERVICE_ROLE_KEY` | Match `PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in the app's `.env`. Ship with Supabase's own published demo values — fine on a machine only you reach, mint your own (`utils/generate-keys.sh` in supabase/supabase) before anyone else can reach this instance. |
| `DASHBOARD_PASSWORD` | Gates Kong's login prompt in front of Studio (`--profile studio`). |
| `SECRET_KEY_BASE` | Encrypts Realtime's internal channel state. 64+ random characters. |

## Security

- **The service-role key never reaches the client.** It's read only in `src/lib/server/**`
  (`$env/dynamic/private`, not `$env/dynamic/public`) — grep `SUPABASE_SERVICE_ROLE_KEY` if you
  add a new server module and keep it that way.
- **RLS is on everywhere.** Every table migration in `supabase/migrations/` enables row-level
  security and scopes reads/writes to the authenticated owner (`auth_brand_ids()`,
  `org_members`, …). The anon key alone can't read another tenant's rows; `db-seed.mjs`'s demo
  user goes through the same GoTrue signup path a real user takes, not a bypass.
- **Every cron/worker endpoint is fail-closed — in a production build.** `CRON_SECRET` (or the
  endpoint's own secret, e.g. `AUTOPILOT_SECRET`) unset means 401 on every call. Under
  `npm run dev`, which is what the install above tells you to run, 48 of those handlers skip the
  check on purpose (`if (dev) return true`). Vite only binds localhost, so that is safe on your own
  machine — it stops being safe the moment you put a reverse proxy in front of it. Expose the app
  only from a real build.
- **No telemetry defaults to us.** PostHog, Sentry, Clarity, Seline and the Meta Pixel / CAPI all
  read a key from your own env and no-op without one; none of them ship with an Anomalia project
  id, token or DSN baked in as a default. (Seline and the Meta Pixel did until this was fixed — a
  self-hosted instance served from a real hostname was loading our pixel and identifying its own
  logged-in users, email included, into our Seline project. If you forked before that, update.)
  If you set `PUBLIC_SENTRY_DSN`, use your own Sentry project, not ours.
- **Don't commit `infra/compose/.env` or the app's `.env`.** Both are gitignored already; double
  check before pushing a fork.
