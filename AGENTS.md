# Anomalia — Social Media AI Autopilot

## CLI

The `anomalia` CLI lives in this repo at **`cli/`** (AGPL-3.0, source of CLI + MCP server +
agent skills + Claude/Codex plugins). It is a thin HTTP client — it never touches the database,
it only calls the API in `src/routes/api/v1/`. CLI, endpoints and MCP tools change in the same
PRs here; releases are `cli-v*` tags (workflow `cli-release.yml`).

```bash
# Install (standalone binary, no runtime needed)
curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh | bash
anomalia login

# Quick commands
anomalia brands                                    # List brands
anomalia dashboard <slug>                          # Brand overview
anomalia content <slug> --status pending_user      # Pending posts
anomalia approve <slug> --all                      # Approve all pending
anomalia post <slug> <id> edit --caption "..."     # Edit post
anomalia post <slug> <id> slide --index 1 ...      # Edit one carousel slide
anomalia plan <slug>                               # View editorial plan
anomalia weekly-plan <slug> produce --week 0       # Produce posts
anomalia seo <slug>                                # SEO grade + initiatives
anomalia geo <slug>                                # AI visibility / citations
anomalia keywords <slug>                           # Keyword strategy
anomalia web <slug>                                # Blog articles (drafts too)
# Backlinks network lives at GET/POST /api/v1/brands/:slug/backlinks (CLI command TBD — see cli/)
# Idea bank: GET/POST /api/v1/brands/:slug/ideas (disruptive ideas agents save — docs/42)
# Field watch: GET/POST /api/v1/brands/:slug/market/field (what moves in the brand's field, taken apart)
# Radar self-test: GET /api/v1/brands/:slug/radar/diagnose (fetches every source live, says why one finds nothing)
# Brand doctor: GET /api/v1/brands/:slug/doctor (per cycle, the first gate the brand fails and how to unlock it)
# Agent Library: GET /api/v1/agent-templates (public catalogue behind /agents + Automations › Custom Agents)
# Chat goals: GET /api/v1/brands/:slug/goals (history + summary of goal mode — met_first_pass, laps, stopped_by)
anomalia studio <slug> add-note --text "..."       # Add knowledge
anomalia ai <slug> --message "..."                 # AI chat (full access)
```

## Architecture (this repo — the server side of the CLI)

- **API** (`src/routes/api/v1/`) — REST endpoints the CLI calls. Adding a CLI command usually
  starts with an endpoint here.
- **Shared queries** (`src/lib/server/cli-queries.ts`) — reusable read functions
- **Auth** (`src/lib/server/cli-auth.ts`) — Bearer auth (Supabase JWT or `anomalia_` API key),
  `loadBrandForUser`, and `gateAiAction` (paid plan + credits) for endpoints that spend AI
- **Login callback** (`src/routes/cli/callback/`) — the page the browser login flow posts back to

## Connectors (Composio)

External apps are brokered by **Composio** (`COMPOSIO_API_KEY`), not by us: it holds the OAuth
tokens and we store only the connected account id. Provider APIs are called through the Composio
proxy (`composioProxy`), so no access token is ever read or logged in this repo.

- **Client** `src/lib/server/composio.ts` — REST v3.1: toolkits, auth configs, Connect Links,
  connected accounts, tools, proxy.
- **Catalog + brand rows** `src/lib/server/composio-catalog.ts` (+ client-safe
  `src/lib/composio-catalog.ts`) — `app_integration_registry` decides what brands see,
  `brand_app_connections` mirrors Composio and is reconciled on read.
- **Agent tools** `src/lib/server/composio-agent.ts` — backs the chat tools
  `list_integrations_tools` / `call_integrations_tools`.
- **Knowledge ingest** `src/lib/server/knowledge-sources.ts` + `knowledge-connectors/` — Drive,
  Notion, GitHub, Gmail into `brand_documents`.
- **Surfaces**: Settings → Connectors (browser), and `/api/v1/brands/:slug/connections*` for the
  CLI and MCP (`anomalia connections`). Docs: [`docs/api/09-connections.md`](docs/api/09-connections.md).
- **Outbound webhooks** `brand-webhooks.ts` + `brand-triggers.ts` — Composio posts every trigger
  event to one project URL (`/api/v1/composio/webhook`, `COMPOSIO_WEBHOOK_SECRET`); we fan out to
  each brand's own endpoint with our signature, retries (`/api/v1/webhooks/work`, cron) and a
  delivery log. Trigger instances are created and deleted from the brand's own state: an endpoint
  plus a connected toolkit plus something selected to watch.

Composio-managed auth means most toolkits need no OAuth app of ours; create a custom auth config
in the Composio dashboard when a toolkit needs our branding, scopes or quota — the code prefers a
custom config over the managed one automatically.

## How code is written here: clean architecture and Kent Beck's method (a rule, not a habit)

It applies to new code **and** to refactoring existing code. The `clean-architecture` skill and
the Kent Beck one load per session, so they are not enough: the rule lives here.

**Dependencies always point inward.** Entities know nothing about use cases, use cases know
nothing about adapters, adapters know nothing about the framework. When control must flow the
other way, the dependency is inverted with a port declared by the inner layer and implemented by
the outer one — never a direct reference outward. Simple data structures cross the boundaries:
never an entity, never a database row, never a third-party library's format penetrating inward.

In this repo the boundary is already marked and a test holds it: `packages/no-app-imports.test.ts`
keeps a package from importing the app. A package that needs `$lib` is asking to live elsewhere.

**Kent Beck's method, the three parts that count:**

1. **The failing test first.** Not ceremony: a test that never failed proves nothing. Red, green,
   then tidy up. When fixing a defect, the test that reproduces it is written BEFORE the fix and
   watched fail.
2. **Reordering is separated from behavior changes.** One commit moves things without changing
   what they do, another changes what they do without moving them. Mixing them makes it
   impossible to tell which one broke which — and here, where turns cost real money, it is the
   difference between a ten-minute diagnosis and a two-hour one.
3. **The four rules of simple design**, in order: passes the tests; says the intent; repeats
   nothing; has the fewest parts. In that order — the third and fourth do not justify breaking
   the first two.

**The criterion against defensive abstraction.** An interface with a single implementation, a
layer that exists for symmetry, a config for a value that never changes: complexity paid today
for a contingency that never arrives. The question to ask is one only — *is this separation
giving me a real benefit right now?* If the answer is "it will one day", it doesn't serve.

## Code is not commented: it is written better (a rule, not a habit)

**No comments are written. The ones there are, are removed.** A comment is the confession that
the code doesn't say by itself what it does: if one is needed, the code gets rewritten, not
annotated. If a piece *looks strange*, it isn't strange — it is badly written, and the strangeness
comes out by rewriting it.

Where the knowledge that today ends up in comments belongs is somewhere else, and more durable:

- **The name.** `CHAT_MAX_DURATION_MS` doesn't need a line explaining what it is. A function that
  requires a three-line preamble requires none if it is named after what it does.
- **The type.** A constraint expressed in a type cannot be ignored; in a comment, it can.
- **The test.** An incident counts as a test, not as a story at the top of the file: the test
  fails if the defect returns, the comment doesn't. `il reaper non uccide un run che sta lavorando`
  is a test name, and it lives forever; the same concept in a comment ages and lies.

An expired comment is worse than no comment: we paid for one that described a decision already
reversed and led to a wrong diagnosis.

**And the code underneath must be kept up to the rule**, or removing comments leaves only dark
code:

- **Clean, solid, testable.** If something is hard to test, it is badly built: the difficulty of
  the test is the measure, not an obstacle to route around with one more mock.
- **Never cyclic dependencies.** If A needs B that needs A, the boundary is in the wrong place.
- **Never outside your own level of responsibility.** A component doesn't talk to the database,
  an adapter doesn't decide a product rule, a package doesn't import the app.
- **Never scattered conditions, single or chained.** An `if` on a particular case, then another,
  then a third, is a registry that was never written. Exceptions are declared **in one place
  only, next to the model that governs them**: a table that says how every case behaves, so the
  next case is added with a row and all of them are visible together. A rule written in five
  places diverges at the first change — and diverges silently.

## Two changelogs, always both (a rule, not a habit)

Every change a user can notice updates **two**, in the same commit. Both are **one file per
entry** — two PRs in parallel touch different files and the changelogs never conflict:

1. **`changelog/YYYY-MM-DD-<slug>.md`** — for whoever works on the code. Why the thing exists,
   what was there before, which decisions were made and what was discarded. Convention in
   `changelog/README.md`. **`CHANGELOG.md` is frozen** (historical archive): nothing is added
   there anymore.
2. **`src/lib/content/changelog/YYYY-MM-DD-<slug>.ts`** — the **public** changelog, the one the
   customer reads. It is **English only**, one `ChangelogEntry` as export default; the loader
   (`src/lib/content/changelog/index.ts`) sorts them newest first. One line per feature, few
   words, release-note style ("Motion videos now have voice-over and music by default"), not a
   paragraph. The page `src/routes/[[lang=locale]]/changelog/+page.svelte` is not touched: it
   already shows everything.

They are two different texts, not the same text translated. The public one doesn't name files,
functions, tables or internal tool names: it says **what changes for whoever uses the product**,
in the present tense, in sentences that make sense without knowing how it is built inside. A
name the user actually types (`/goal`) belongs there; `decideGoalContinuation` doesn't.

Skip the public changelog only when the change is genuinely invisible from outside: a refactor,
an index, a test, a log. When in doubt, write it — one more line in the public changelog costs
far less than a shipped feature nobody discovers.

## `git stash` non si usa, mai (una regola, non un'abitudine)

`git stash` legge e scrive **lo stesso ref** (`refs/stash`) per l'intero repository, non per
worktree. Con più worktree aperti — che qui è la norma, uno per task — uno stash preso in uno può
essere riesumato in un altro e sostituire in silenzio i tuoi edit con quelli di un lavoro
estraneo. È già successo, ed è costato lavoro perso: la storia sta in [`LESSONS.md`](LESSONS.md).

Non c'è un caso in cui valga la pena: **un hook `PreToolUse` lo blocca prima che parta.** Per
sospendere delle modifiche ci sono tre strade, tutte più sicure e nessuna più lenta:

- **committa sul branch del task** — è per questo che il branch esiste, e un commit di lavoro si
  riscrive dopo con un `rebase -i` o un `commit --amend`;
- **`git diff > /tmp/patch.diff && git checkout -- <file>`**, e più tardi `git apply` — la patch è
  un file tuo, che nessun altro worktree può reclamare;
- **usa il checkout dedicato**, se ti serve una copia pulita mentre tieni le modifiche altrove.

## Lessons already paid for: LESSONS.md (a rule, not a habit)

[`LESSONS.md`](LESSONS.md) keeps the lessons learned from real incidents — stale node_modules
after a rebase, full-suite flakiness versus a true defect, closed PRs that look like API lag.
A lesson is the **signal** that lets you recognize the failure and the **move** that solves it,
no stories.

- **Before diagnosing** a strange problem (dependencies, tests, worktrees, PRs): read it — it has
  already happened to someone.
- **When a new lesson is paid for**, it goes into LESSONS.md in the same commit that paid for it.
  Updating LESSONS.md is as non-optional as writing the test.

## Agent evaluation, before anything that matters (a rule, not a habit)

Unit tests (5200, all green) verify that the **code is well built**. They have never prevented a
single quality defect, because they run on a fake model and a fake database: brand context
arrived empty, attachments were rejected by a constraint, the model resolved to the wrong one,
and a read crossed every brand of the user — **green suite for everyone**.

The evaluation (`scripts/eval/`) is the only thing that verifies **the product works**: it puts
the real agents to work on a disposable trial brand, with real requests, and judges FACTS before
tastes — does the artifact exist? is the number right? how many text blocks? what did it cost?

**What exists today. Only this command is real:**

```bash
npm run eval:durability   # the work does not vanish: 3 scenarios against the real database and the real plpgsql
npm run eval:durability -- --only=<scenario>
```

`eval:durability` measures whether the product *keeps what it produced* — a turn killed
mid-work, the salvage when it gives up, and a taken-over run that must not deposit a second
message. It runs against real SQL, which is the whole point: the two defects that slipped
through in one session were a changed function signature and a reaper whose contract had moved
under its own tests, and a fake client cannot see either.

**What does NOT exist, so nobody writes it in a report as if it had run:** `npm run eval`,
`npm run eval:ux` — the onboarding walk was removed: it cost real money on every run and graded
the in-app chat, which is not where the product is going — the
`--all` / `--budget` / `--jobs` / `--compare` flags, cost read from `ai_calls`, `docs/EVAL_PLAN.md`,
and the browser engine with a throttled network. The richer scenario catalogue described in the
frozen `CHANGELOG.md` (`brand-nudo`, `conteggio-secco`, …) was designed and never merged. Reading
about a command here is not evidence that it runs — check `package.json`.

**When to run it** — not on every commit (it costs real money), but always:

1. **Before a merge that touches the chat path, prompts, tools or the model.** The comparison
   with the last run is the real question: *did it get worse?*
2. **Before turning something big on**: a new model, a new engine (harness), a bridge refactor.
   The verdict comes from the eval, not an opinion.
3. **When a quality defect is reported**: first write the scenario that reproduces it, then fix
   it. A scenario that cannot fail is dead weight; one that fails is a real defect.
4. **After fixing it**: the scenario becomes the guardian that keeps it from coming back.

**The rules that make the verdict reliable:**

- A report must NEVER confuse "green" with "never tried": unexecuted scenarios carry an `unrun`
  field with the reason, printed before the round. An eval that lies is worse than an agent that
  promises and doesn't deliver.
- **The trial brand is always destroyed**, even on errors (`finally`). And Storage is cleaned
  separately: AI images live under `media/<userId>/`, indexed on the user, so the cascade on
  brands doesn't take them away.
- Cost is read from `ai_calls` **while the brand exists**: after teardown the cascade takes it.
- An eval run from a worktree measures a **hybrid**: `$lib` points at your copy, but
  `@anomalia/*` resolves from the main checkout's `node_modules`. If you touched `packages/`,
  your eval doesn't see it.

The criterion of a good scenario is one only: **if you re-ran the real failures already seen,
would this one catch them?** If a real defect would not have been caught by any scenario, the
scenario is missing.

**Two families, not one.** The *quality* scenarios (does the agent answer well? deliver? use the
brand's context?) run server-side and stand alone. The *durability* scenarios — bad network, tab
closed and reopened mid-work, a turn that outlasts 30 minutes and must continue alone — need a
real browser with a throttled network, so they live alongside but on another engine. A product
that answers well and loses work when the line drops is not ready: measure both.

## The commit author, or Vercel won't build

Vercel blocks the deploy when the commit author is not a team member — and "member" is decided
by GitHub resolving the **author's email** to an account. A commit signed with an address GitHub
doesn't know arrives without `githubCommitAuthorLogin`, and the deployment is born `BLOCKED`
(`errorLink` → *troubleshoot-project-collaboration#account-configuration*). The merge lands, the
code is on GitHub, and production stays pinned to the commit before: the quietest way to not
ship.

So commit with the identity GitHub actually resolves:

```
Andrea Buttarelli <49411143+andreabuttarelli@users.noreply.github.com>
```

The Claude account's email is **not** that identity: it has already blocked two deploys.

## Running

The SvelteKit dev server must be running for the CLI to work against a local instance:
```bash
npm run dev  # Starts on port 5173
```

The CLI auto-detects a dev server on `localhost:5173` and falls back to production otherwise;
override with `PUBLIC_APP_URL`.

This repo's deploys **do not** run migrations, so the schema and what the code expects drift in
silence: `node scripts/schema-drift-check.mjs` redoes the comparison (read-only, anon key, zero
rows: pointing at production without fear) and says which migrations are not applied and which
names are wrong in the code. Run it after every migration written and before any change that
touches the database; it exits 1 if it finds something.

## AGENT.MD

- When writing something intended for human consumption, (comment, commit message, reply to prompt) use as few words as possible. Pick every word meticulously to reduce the volume to a strict minimum. Be down to the point. Less is more.

- Avoid superlatives and praise. Stop telling me I am absolutely right. Give me the cold hard truth.

- Avoid magic numbers and strings by extracting recurring or meaningful values into descriptive constants (const) or enums. Keep self-explanatory, one-off values inline to avoid clutter. If a value comes from a spec (e.g. HTTP 200 OK), use a constant regardless.

- Reduce code indentation. Avoid Arrow Anti-Pattern. Leverage early return and continue.

- Keep function names short. Less than 30 characters.

- Use enums instead of booleans for function parameters.

- Let the reader of the code breathe. Add empty lines between logical blocks of code.

- Add a small, to the point, comment to explain *what* the block does and *why*. Use examples when possible. Propose ASCII drawings to explain complete systems.

- Treat member visibility changes as a breaking design shift. Keep all fields and functions private unless external access is strictly required by the design. Prompt the user for explicit approval before changing any access modifier from private to internal or public.

- Program to levels of abstraction. Lower-level mechanics (e.g., raw hardware I/O, sector parsing, direct socket streams) must be encapsulated in a dedicated driver/abstraction layer. Expose clean, high-level APIs to the rest of the application so calling code works with domain concepts, not raw implementation details.

- Don't touch blocks of code unrelated to the feature you implement. e.g. Don't add comments to a block of code if you did not create it or modify it. As much as possible try to minimize the number of changed lines when implementing a feature.

- Strictly adhere to the layered boundary hierarchy: each layer may only communicate with its immediate neighbor directly below it. Never "punch holes" through layers (e.g., controllers or UI components must never directly call database queries, raw hardware drivers, or low-level network clients; always route through the intermediate service/abstraction layer).

- Always use {}, even on a one-line "if" statement.

When you write a commit message, follow these 7 rules:
Rule 1: Separate the subject line from the body with a single blank line.
Rule 2: Limit the subject line to 50 characters (72 is the absolute hard limit).
Rule 3: Capitalize the first letter of the subject line.
Rule 4: Do not end the subject line with a period.
Rule 5: Use the imperative mood in the subject line (e.g., "Fix bug," "Add feature," 
        not "Fixed" or "Adds"). Test formula: It must complete the sentence: "If applied,
        this commit will [your subject line here]".
Rule 6: Wrap the body text manually at 72 characters to prevent Git formatting issues.
Rule 7: Use the body to explain what and why vs. how. Assume the code explains the how;
        the message must explain the context and reasoning. 

- If the prompt indicates that a bug is being fixed, don't write the fix right away. First write the test. Observe it failing. Then write the fix. And observe the test passing.

## Mattpocock skills (use them often)

Prefer these skills over improvising; load them with the `skill` tool.

- Any non-trivial change or new feature → `grill-with-docs` (outside code: `grill-me`)
- Implementing from a spec or tickets → `implement`, driving `tdd` (red-green-refactor)
- Bug or perf regression → `diagnosing-bugs`
- Design question needing an answer fast → `prototype`
- Decision hard to explain → `domain-modeling` (CONTEXT.md / ADR)
- Feature ready to close → `code-review`
- Planning large work → `to-spec` → `to-tickets`; bigger than one session → `wayfinder`

The user-invoked skills (`grill-with-docs`, `to-spec`, `implement`, `wayfinder`) fire on explicit
request; the others you load yourself when the task matches.

## Tasks = Notion "Anomalia > Tasks"

When "the tasks" are mentioned, the **Anomalia > Tasks** database is meant (page "Tasks",
inline database "✅ Team Tasks", data source `collection://d5551c37-1a6f-4bf2-89c8-af84a1d5dcec`).
Don't look for other task databases.
