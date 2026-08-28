# Contributing

Pull requests are welcome under Apache-2.0 — no CLA. This file is the short version of what this
codebase expects; the long version of the setup is [`docs/SELF_HOSTING.md`](./docs/SELF_HOSTING.md).

## Setting up

You need Docker, Node ≥ 22 and `openssl`. There is **no hosted dev database** you can borrow: you
run your own Supabase stack.

```bash
cp infra/compose/.env.example infra/compose/.env   # fill POSTGRES_PASSWORD, DASHBOARD_PASSWORD, SECRET_KEY_BASE
cp .env.example .env                               # PUBLIC_SUPABASE_URL=http://localhost:8000, keys, provider keys
(cd infra/compose && docker compose up -d --wait)  # Postgres + Auth + REST + Storage + Realtime
npm install

export DATABASE_URL="postgres://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres"
npm run db:migrate   # applies supabase/migrations/*.sql in order — idempotent, re-runnable
npm run db:seed      # one demo user + org + brand to log in with
npm run dev          # http://localhost:5173
```

`--wait` is not decoration: `0004` needs `storage.buckets` and `0137` needs `realtime.messages`,
and those tables are created by the storage and realtime containers on their own startup. If
`db:migrate` stops with `relation "storage.buckets" does not exist`, the container simply wasn't
ready — run `npm run db:migrate` again, it resumes from the first unapplied file.

**Migrations are applied by hand, and deploys do not run them.** Schema and code drift silently
here — it has already cost eight days of every graphic reading back empty. After writing a
migration, and before any change that touches the database, run:

```bash
node scripts/schema-drift-check.mjs   # read-only, anon key, zero rows; exits 1 on drift
```

## Tests

```bash
npm run test:unit               # the whole vitest suite
npx vitest run packages/        # just the agent packages (213 tests, green)
npx vitest run path/to/file.test.ts
npm run check                   # svelte-check
```

Run at least the files your change touches, and say in the PR which ones you ran. Two honest
caveats so you don't spend an afternoon on someone else's problem: `src/lib/motion-video/library.test.ts`
has 15 failing tests on `main` today, and `npm run check` reports a few hundred pre-existing
errors. Neither is yours — just don't add to them.

There is no CI running tests on PRs. The suite is the reviewer's, and yours.

The other tiers — e2e, the durability harness and the live eval (which costs real credits) — are
in [Testing](./README.md#testing) in the README.

## Conventions

**Two changelogs, same commit.** Anything a user can notice updates both — and both are
**one file per entry**, so two PRs in parallel never touch the same changelog file:

1. `changelog/YYYY-MM-DD-<slug>.md` — for whoever works on the code. Why the thing existed, what
   was there before, what was decided and what was discarded. Convention: `changelog/README.md`.
   `CHANGELOG.md` is a frozen archive — nothing new goes there.
2. `src/lib/content/changelog/YYYY-MM-DD-<slug>.ts` — the **public** changelog, English only,
   one short release-note line per feature (`ChangelogEntry` export; loader in
   `src/lib/content/changelog/index.ts`). It names no file, function, table or internal tool:
   it says what changes for someone using the product. A command a user actually types (`/goal`)
   is fine; `decideGoalContinuation` is not.

Skip the public one only when the change is genuinely invisible from outside — a refactor, an
index, a test, a log line. When in doubt, write it: an extra line costs far less than a shipped
feature nobody discovers.

**Commit identity.** Vercel refuses to build a commit whose author email GitHub cannot resolve to
an account: the merge lands, production stays on the previous commit, and nothing tells you. Use
an email attached to your GitHub account — for maintainers of this repo that means the
`…@users.noreply.github.com` address, not a generic one.

**Never commit secrets.** `.env` and `infra/compose/.env` are gitignored; keep it that way. No API
key, token, database URL or customer data in code, in tests, in docs, or in a migration comment.
If something leaked, see [`SECURITY.md`](./SECURITY.md) — don't fix it quietly in a public PR.

**`packages/*` cannot import the app.** The five agent packages (`@anomalia/agent-{kit,contracts,core,adapters,client}`)
must never import `$lib/*` or `$env/*` — they don't exist outside SvelteKit. Real dependencies
arrive as constructor deps, wired in exactly one file (`src/lib/agent/bridge/adapters.ts`).
`packages/no-app-imports.test.ts` enforces this on every commit; each package has its own README.

**Comments are in Italian, public files are in English.** Code comments in this repo are written
in Italian and that is not changing. Anything a stranger reads first — README, CONTRIBUTING,
SECURITY, the public changelog, package READMEs — is English.

## Proposing a change

1. Open an issue first if it's big, or if it changes a database schema or a public API shape.
   Small fixes can go straight to a PR.
2. Branch off `main`. Keep the diff to one thing.
3. Include the tests you'd want if you were reviewing it, and both changelog entries.
4. In the PR body, say what you ran and what you did not. "I didn't run the e2e suite" is a fine
   sentence; a silent gap is not.

The `anomalia` CLI, its MCP server and the publishable agent skills live in [`cli/`](cli/) of this
same repository (AGPL-3.0, released from `cli-v*` tags). CLI changes are PRs here like any other.
