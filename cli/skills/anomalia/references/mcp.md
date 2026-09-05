# Anomalia MCP — setup & usage

Model Context Protocol server for Anomalia. Same HTTPS client and OAuth as the CLI.
**No static API tokens.**

```
Host (Cursor / Claude / …)
  ├─ stdio  → bun run mcp / anomalia-mcp
  └─ HTTPS  → https://mcp.anomalia.so/mcp  (+ Bearer on remote)
         └─ Anomalia API /api/v1/*
```

## 1. Pick a transport

| Mode | When | Endpoint / command | Auth |
|------|------|--------------------|------|
| **stdio** | Local agent on your machine | `bun run mcp` or `anomalia-mcp` | existing `anomalia login` session |
| **HTTP local** | Local Streamable HTTP | `bun run mcp:http` → `http://localhost:8787/mcp` | Bearer **or** session file |
| **HTTP remote** | Shared / cloud host | `https://mcp.anomalia.so/mcp` | **Bearer required** |

Health check (HTTP):

```bash
curl -sS https://mcp.anomalia.so/health
# {"ok":true,"name":"anomalia-mcp","transport":"streamable-http","mcp":"/mcp"}
```

OAuth resource metadata: `GET /.well-known/oauth-protected-resource`.

## 2. Configure the host

### Cursor — stdio (recommended locally)

Clone or install the repo, then in Cursor MCP settings:

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

If the binary is on `PATH` after install:

```json
{
  "mcpServers": {
    "anomalia": { "command": "anomalia-mcp" }
  }
}
```

### Cursor — HTTP remote

```json
{
  "mcpServers": {
    "anomalia": {
      "url": "https://mcp.anomalia.so/mcp"
    }
  }
}
```

The host must send OAuth Bearer. If it cannot yet, use [mcp-remote](https://www.npmjs.com/package/mcp-remote) as a bridge, or prefer **stdio** locally.

### From source (dev)

```bash
git clone https://github.com/anomaliaso/anomalia.git
cd anomalia-cli
bun install
bun run mcp          # stdio
bun run mcp:http     # http://localhost:8787/mcp
```

## 3. Authenticate

**Local (stdio / local HTTP)**

1. Run `anomalia login` in a terminal — it opens the browser. There is no MCP tool for this: the
   one that existed only worked on stdio, and its `logout` twin reported success after deleting
   nothing.
2. Session is stored at `~/.config/anomalia/session.json` and shared with the CLI.
3. `list_brands` to confirm — brands come back, or you are not signed in.

**Remote HTTP**

Your host does this on its own: the server publishes `/.well-known/oauth-protected-resource` and
answers an unauthenticated call with `401 WWW-Authenticate: Bearer`, which is the standard round
Claude Code, Claude.ai and Cursor already know how to walk.

1. If you are calling it by hand: obtain a Supabase access token via Anomalia OAuth (same token
   inside `session.json` after CLI login: field used as Bearer).
2. Send on every request: `Authorization: Bearer <access_token>`.
3. Without it you get JSON-RPC **401** — that is expected, not a server crash.

There is **no** `ANOMALIA_TOKEN` / API-key path by design.

## 4. First calls

1. `list_brands` — learn brand **slugs**.
2. `get_dashboard` with `slug` — overview.
3. `list_posts` with `slug` and status `pending_user` — approval queue.

Ids from list tools accept short unambiguous prefixes (same rule as the CLI).

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| 401 on `/mcp` | Missing/invalid Bearer on remote | Let the host do the OAuth round, or pass the access token yourself, or use stdio |
| 404 on `/health` | Wrong deploy root / path | Expect `/health` and `/mcp` on the MCP host |
| Tools missing | MCP not connected in host | Check Cursor MCP panel; restart host |
| Auth works in CLI but not MCP | Different machine / no session file | Run `anomalia login` on the machine running the MCP server |
| `Not an https or loopback URI: cursor://anysphere.cursor-mcp/oauth/callback` | Cursor DCR uses a custom-scheme callback; Anomalia OAuth only allows https/loopback | Use **stdio** MCP, update Cursor (localhost `:8787` callback), or pass Bearer; see [docs/mcp.md](../../../docs/mcp.md#cursor--remote-http-oauth) |

## 6. More

- Full tool list: [tools.md](tools.md)
- CLI fallback: [cli.md](cli.md)
- Product: https://anomalia.so · Repo: https://github.com/anomaliaso/anomalia
