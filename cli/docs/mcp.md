# Anomalia MCP — how to use it

Anomalia exposes a [Model Context Protocol](https://modelcontextprotocol.io) server so coding agents
(Cursor, Claude, etc.) can manage brands, posts, plans, studio, SEO/GEO, and blog — with the **same
OAuth login as the CLI**. There are **no static API tokens**.

```
Your agent
   │  stdio (local)     →  bun run mcp  /  anomalia-mcp
   │  HTTPS (remote)    →  https://mcp.anomalia.so/mcp  + Bearer
   ▼
Anomalia API  (/api/v1/*)
```

## Quick start

### Option A — Local stdio (simplest)

1. Install [Bun](https://bun.sh) and clone the repo (or install the CLI binary).
2. Authenticate once:

```bash
anomalia login
# or, after MCP is connected, call the `login` tool
```

3. Add to Cursor MCP config (absolute path required):

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

4. Restart Cursor / reload MCP. Call `list_brands`, then work with a brand `slug`.

Session file (shared with the CLI): `~/.config/anomalia/session.json`.

### Option B — Remote HTTP (`mcp.anomalia.so`)

1. Confirm the server is up:

```bash
curl -sS https://mcp.anomalia.so/health
```

Expect: `{"ok":true,"name":"anomalia-mcp","mcp":"/mcp",...}`.

2. Cursor MCP config:

```json
{
  "mcpServers": {
    "anomalia": {
      "url": "https://mcp.anomalia.so/mcp"
    }
  }
}
```

3. The host must send **`Authorization: Bearer <access_token>`** on every request.  
   Use the Supabase access token from Anomalia OAuth (same value the CLI stores after `anomalia login`).  
   Without Bearer you get **401** — that is correct, not a crash.

If your client cannot attach Bearer yet, use [mcp-remote](https://www.npmjs.com/package/mcp-remote) or prefer **Option A**.

### Option C — Local HTTP

```bash
bun install
bun run mcp:http
# → http://localhost:8787/mcp
#    http://localhost:8787/health
```

Auth: Bearer **or** the local session file.

## What to call first

1. `list_brands` — discover slugs  
2. `get_dashboard` — brand overview  
3. `list_posts` with status `pending_user` — approval queue  
4. Prefer specific tools (`approve_posts`, `edit_post`, …) over `chat` for precise actions  

Post and article ids accept **short unambiguous prefixes** from list results (same rule as the CLI).

## Tool areas

| Area | Examples |
|------|----------|
| Auth | `login`, `logout`, `whoami`, `list_brands` |
| Posts | `list_posts`, `get_post`, `edit_post`, `approve_posts`, `regenerate_slide`, `make_video` |
| Plans | `get_plan`, `propose_plan`, `plan_week`, `produce_week` |
| Studio | `get_studio`, `add_note`, `research_competitors` |
| Web | `get_seo`, `get_geo`, `generate_article`, `chat` |

Full map: [`skills/anomalia/references/tools.md`](../skills/anomalia/references/tools.md).

## Agent skill (directories / `npx skills`)

Publishable Agent Skill (agentskills.io):

```bash
npx skills add anomaliaso/anomalia --skill anomalia
```

Sources: [`skills/anomalia/`](../skills/anomalia/) (`SKILL.md` + `references/`).  
Claude/Codex marketplace plugin (skill + remote MCP): [`plugins/anomalia/`](../plugins/anomalia/) — see [`plugins.md`](plugins.md).

## Auth rules (summary)

| Context | How you authenticate |
|---------|----------------------|
| Local stdio / local HTTP | Browser `login` tool or `anomalia login` → session file |
| Remote HTTP | `Authorization: Bearer <jwt>` required |
| Static API key | **Not supported** |

Protected resource metadata: `GET /.well-known/oauth-protected-resource`.

## Cursor + remote HTTP OAuth

Cursor’s remote MCP connector discovers Anomalia’s authorization server and runs
[Dynamic Client Registration](https://datatracker.ietf.org/doc/html/rfc7591). Some Cursor
builds still register the custom-scheme callback:

```text
cursor://anysphere.cursor-mcp/oauth/callback
```

Anomalia’s `/oauth/register` only accepts **https** or **loopback http** redirect URIs, so that
registration fails with:

```text
Not an https or loopback URI: cursor://anysphere.cursor-mcp/oauth/callback
```

**Workarounds (pick one):**

1. **Prefer stdio locally** (recommended) — no remote OAuth handshake:

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

Then call the `login` tool (or run `anomalia login` first).

2. **Update Cursor** so MCP OAuth uses the loopback callback
   `http://localhost:8787/callback` (RFC 8252). That URI **is** accepted by Anomalia DCR.

3. **Bearer header** — after `anomalia login`, put the access token from
   `~/.config/anomalia/session.json` in the MCP config `headers.Authorization` (if your Cursor
   build supports headers on URL servers), or bridge with
   [mcp-remote](https://www.npmjs.com/package/mcp-remote).

**Permanent fix (Anomalia app, not this repo):** allowlist Cursor’s known redirect URIs in the
authorization server’s DCR validator (`/oauth/register`), including
`cursor://anysphere.cursor-mcp/oauth/callback` and
`https://www.cursor.com/agents/mcp/oauth/callback`, while keeping loopback `http://localhost`
/ `http://127.0.0.1` allowed.

## Deploy notes (operators)

Vercel project **Root Directory = `mcp`**. Artifacts: `mcp/api/*`, `mcp/vercel.json`.  
Rebuild bundles from repo root: `bun run vercel-build`.  
Optional env: `SENTRY_DSN`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_PUBLIC_URL`, `PUBLIC_APP_URL`.

## Development

```bash
bun run mcp
bun run mcp:http
bun test
bun run typecheck
npx @modelcontextprotocol/inspector bun run mcp/stdio.ts
```

Architecture: `mcp/stdio.ts` / `mcp/http.ts` + `mcp/api/*.js` → `http-router` → `http-app` → `server` → `lib/api.ts`.
