# Anomalia CLI — Social Media AI Automation CLI, MCP Server & Agent Skill

**Automate your social media from the terminal.** [Anomalia](https://anomalia.so) is the social
media AI autopilot that plans, writes, designs and publishes posts, blog articles and SEO/GEO
audits on autopilot. This repository is its command-line client, [MCP server](docs/mcp.md)
(Model Context Protocol — `stdio` + HTTP) and agent skill: everything you need to run social
media automation, content generation and approval workflows from a terminal or an AI agent.

This repository ships **three ways** to drive the same product (same OAuth, same API, **no static tokens**):

| | What | Who it’s for |
|---|------|----------------|
| **CLI** | `anomalia` terminal commands | Humans & scripts |
| **MCP** | Model Context Protocol server (`stdio` + HTTP) | Cursor, Claude, other MCP hosts |
| **Skill** | Agent Skill (`skills/anomalia/`) | Coding agents / skills.sh / `npx skills` |

> **You need an Anomalia account.** This is a client, not a standalone tool: every call talks to
> the Anomalia API over HTTPS. Without an account there is nothing to drive.

With the Anomalia CLI you can automate social media posting, approve AI-generated content in one
tap, edit a carousel slide by slide, turn a post into a video, run SEO and GEO audits, and manage
your blog — from the terminal **or** from an AI agent like Cursor or Claude.

```text
┌─────────────┐   ┌─────────────┐   ┌──────────────────┐
│  anomalia   │   │  MCP host   │   │  Agent + Skill   │
│    CLI      │   │ (Cursor…)   │   │  (npx skills)    │
└──────┬──────┘   └──────┬──────┘   └────────┬─────────┘
       │                 │                   │
       │    lib/api.ts + OAuth session       │
       └─────────────────┼───────────────────┘
                         ▼
                 Anomalia /api/v1/*
```

---

## 1. CLI

### Install

Pick one:

| Method | Command | Notes |
|--------|---------|--------|
| **npm** | `npm install -g anomalia-cli` | Needs Node.js ≥ 20 |
| **Homebrew** | see below | macOS / Linux, standalone binary |
| **Installer** | see below | curl script → binary on PATH |
| **From source** | see below | Needs [Bun](https://bun.sh) |

**npm**

```bash
npm install -g anomalia-cli
# or:  pnpm add -g anomalia-cli   /   bun add -g anomalia-cli
anomalia login
```

**Homebrew** — formula lives in the [`anomaliaso/homebrew-tap`](https://github.com/anomaliaso/homebrew-tap) repository:

```bash
brew tap anomaliaso/tap https://github.com/anomaliaso/homebrew-tap
brew install anomalia
anomalia login
```

**Installer (standalone binary)** — macOS arm64/x64 and Linux arm64/x64, no Node/Bun required:

```bash
curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh | bash
anomalia login
```

Update later with `anomalia update`, or `npm install -g anomalia-cli@latest` / `brew upgrade anomalia` depending on how you installed. More detail: [`docs/distribute.md`](docs/distribute.md).

### Quick start

```bash
anomalia brands
anomalia dashboard my-brand
anomalia content my-brand --status pending_user
anomalia approve my-brand --all
anomalia seo my-brand
anomalia web my-brand generate --topic "..."
anomalia ads my-brand --remix
```

Every command takes the brand slug as its first argument. `anomalia --help` lists them all;
`anomalia <command> --help` details one. Short id prefixes from tables are accepted; ambiguous
prefixes error instead of guessing.

| Area | Commands |
|------|----------|
| Posts | `content`, `approve`, `post <id> [show\|edit\|regenerate\|slide\|reorder\|video\|publish]` |
| Planning | `plan`, `weekly-plan`, `calendar`, `gtm` |
| Brand | `studio`, `voice`, `people`, `products` |
| Web | `seo`, `geo`, `keywords`, `web` |
| Ads | `ads` — campaigns, spend, boost proposals, remix, duplicate/delete (`--sync`, `--propose`, `--remix`, `--create`, `--approve`, `--pause`, `--resume`, `--duplicate`, `--delete`, `--reject`, `--ad` per singola creatività) |
| Insight | `dashboard`, `status`, `analytics` |
| AI | `ai --message "..."` — natural language, full read/write access |

Full command dump: [`llms.txt`](llms.txt) · more docs: [`docs/`](docs/)

### From source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/anomaliaso/anomalia.git
cd anomalia-cli
bun install
bun run cli.ts --help
```

---

## 2. MCP server

Same tools and OAuth as the CLI. Docs: **[`docs/mcp.md`](docs/mcp.md)**.

```bash
bun run mcp          # stdio (local hosts)
bun run mcp:http     # http://localhost:8787/mcp
```

Remote: `https://mcp.anomalia.so/mcp` (Bearer JWT required). Health: `GET /health`.

**Cursor — stdio**

```json
{
  "mcpServers": {
    "anomalia": {
      "command": "bun",
      "args": ["run", "/ABS/PATH/to/anomalia-cli/mcp/stdio.ts"]
    }
  }
}
```

**Cursor — HTTP**

```json
{
  "mcpServers": {
    "anomalia": { "url": "https://mcp.anomalia.so/mcp" }
  }
}
```

If Connect fails with `Not an https or loopback URI: cursor://…`, your Cursor build is still
using the custom-scheme OAuth callback — use **stdio** above, update Cursor (loopback
`http://localhost:8787/callback`), or see [`docs/mcp.md`](docs/mcp.md#cursor--remote-http-oauth).

- Local stdio: `login` tool or existing `anomalia login` → `~/.config/anomalia/session.json`
  (script/CI alternative: `anomalia login --email tu@email --password …` or `--password-stdin`, no browser)
- Remote HTTP: `Authorization: Bearer <access_token>` (401 without it is expected)

---

## 3. Agent Skill & plugins

Publishable [Agent Skill](https://agentskills.io) for Cursor, Claude, skills.sh, and friends:

```bash
npx skills add anomaliaso/anomalia --skill anomalia
# or
bash scripts/install-skill.sh --project
```

Package: [`skills/anomalia/`](skills/anomalia/) → [`plugins/anomalia/skills/anomalia/`](plugins/anomalia/) (`SKILL.md` + `references/` for MCP setup, tool map, CLI).

When the skill is active, agents prefer **MCP tools** if connected, otherwise the **CLI**.

### Claude Code / Codex marketplace plugin

Same skill + remote MCP, packaged for plugin install and directory submit:

```bash
# Claude Code
/plugin marketplace add anomaliaso/anomalia
/plugin install anomalia@anomalia

# Codex
codex plugin marketplace add anomaliaso/anomalia
```

Submit checklist (Claude community directory + OpenAI Plugins Directory): **[`docs/plugins.md`](docs/plugins.md)**.

---

## Configuration

Zero config by default → `https://anomalia.so`, with automatic fallback to
`http://localhost:5173` when a local app is answering.

| Variable | Purpose |
|----------|---------|
| `PUBLIC_APP_URL` | Point CLI/MCP at another Anomalia instance |
| `SENTRY_DSN` | (MCP HTTP / Vercel) Errors → Sentry |
| `SUPABASE_SERVICE_ROLE_KEY` | (MCP HTTP / Vercel) Rows in `mcp_logs` |
| `MCP_PUBLIC_URL` | Public MCP base URL for OAuth metadata |

Session: `~/.config/anomalia/session.json`. `anomalia logout` clears it. No secrets are embedded
in this repo or the binary.

---

## Architecture

Thin HTTPS client — no DB access, no coupling to the Anomalia server codebase:

```
CLI  ──┐
MCP  ──┼── HTTPS ──►  /api/v1/*  ──►  Anomalia
Skill ─┘   (guides agents to CLI or MCP)
```

- CLI commands: `commands/` + `cli.ts`
- HTTP client: `lib/api.ts` only
- MCP: `mcp/` (reuses `lib/api.ts`, registers tools)
- Skill / plugins: `skills/anomalia/` → `plugins/anomalia/` (Claude + Codex marketplace manifests)

---

## Development

```bash
bun install
bun run cli.ts --help
bun run mcp
bun run mcp:http
bun run typecheck
bun test
bun run build             # binary → dist/
bun run build:all         # all four targets
bun run vercel-build      # MCP bundles under mcp/api/
```

Releases: push a `v*` tag → CI typechecks, tests, cross-compiles binaries + `.tar.gz` +
`SHA256SUMS.txt` on the GitHub Release, bumps [`Formula/anomalia.rb`](Formula/anomalia.rb),
and publishes `anomalia-cli` to npm when `NPM_TOKEN` is set. Details: [`docs/distribute.md`](docs/distribute.md).

---

## License

Copyright © 2026 Andrea Buttarelli.

Licensed under the [Apache License 2.0](LICENSE). You may use, modify
and redistribute it, but derivative works must stay open source under the same license, must keep
the copyright notice, and must state their changes — including when offered to users over a
network.
