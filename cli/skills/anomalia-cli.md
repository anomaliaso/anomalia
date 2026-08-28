# Anomalia Skill (MCP + CLI)

Flat copy for Claude Code / multi-tool installers.  
**Canonical publishable skill:** [`anomalia/SKILL.md`](./anomalia/SKILL.md) (Agent Skills / skills.sh).

```bash
npx skills add andreabuttarelli/anomalia-cli --skill anomalia
bash scripts/install-skill.sh --project
```

Prefer **MCP tools** when connected; otherwise the **`anomalia` CLI**. OAuth only — no static tokens.
Details: [anomalia/references/mcp.md](./anomalia/references/mcp.md) · [tools.md](./anomalia/references/tools.md) · [cli.md](./anomalia/references/cli.md).

## Auth

- Local: MCP `login` or `anomalia login` → `~/.config/anomalia/session.json`
- Remote MCP (`https://mcp.anomalia.so/mcp`): `Authorization: Bearer <access_token>`
- Start with `list_brands` / `anomalia brands`

## Cursor MCP (stdio)

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

## Cursor MCP (HTTP)

```json
{
  "mcpServers": {
    "anomalia": { "url": "https://mcp.anomalia.so/mcp" }
  }
}
```

## CLI fallback

```bash
curl -sSL https://raw.githubusercontent.com/andreabuttarelli/anomalia-cli/main/scripts/install.sh | bash
anomalia login
anomalia brands
anomalia content <slug> --status pending_user
anomalia approve <slug> --all
anomalia ai <slug> --message "..." --pipe
```
