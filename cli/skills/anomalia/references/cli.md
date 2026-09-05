# Anomalia CLI (fallback)

Use when MCP is not connected. Same OAuth session as MCP (`~/.config/anomalia/session.json`).

## Install

```bash
curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh | bash
anomalia login
```

From source (Bun):

```bash
git clone https://github.com/anomaliaso/anomalia.git
cd anomalia-cli && bun install
bun run cli.ts --help
```

## Common commands

```bash
anomalia brands
anomalia dashboard <slug>
anomalia content <slug> --status pending_user
anomalia approve <slug> --all
anomalia post <slug> <id> edit --caption "..."
anomalia post <slug> <id> regenerate --instruction "..."
anomalia post <slug> <id> slide --index 1 --instruction "..."
anomalia post <slug> <id> approve|publish|reject
anomalia plan <slug> propose
anomalia weekly-plan <slug> plan --week 0
anomalia weekly-plan <slug> produce --week 0
anomalia studio <slug> add-note --text "..."
anomalia seo <slug>
anomalia geo <slug>
anomalia web <slug> generate --topic "..."
```

Full dump: repo root [`llms.txt`](https://github.com/anomaliaso/anomalia/blob/main/cli/llms.txt).
Tool mapping: [tools.md](tools.md).
