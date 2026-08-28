# Anomalia plugin — Claude Code & Codex submit

The installable plugin lives in [`plugins/anomalia/`](../plugins/anomalia/). It bundles:

- Agent skill → `skills/anomalia/` (`SKILL.md` + `references/`)
- Remote MCP → `.mcp.json` → `https://mcp.anomalia.so/mcp`
- Manifests → `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`

Repo marketplaces (self-host / team install):

| Agent | Marketplace file | Add / install |
|-------|------------------|---------------|
| Claude Code | [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) | `/plugin marketplace add anomaliaso/anomalia` then `/plugin install anomalia@anomalia` |
| Codex / ChatGPT | [`.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json) | `codex plugin marketplace add anomaliaso/anomalia` |

Local test (Claude):

```bash
claude --plugin-dir ./plugins/anomalia
claude plugin validate ./plugins/anomalia
claude plugin validate .   # marketplace + plugin
```

Canonical Agent Skill for `npx skills`: `skills/anomalia/`.  
After editing it, sync into the plugin with `bash scripts/sync-plugin-skill.sh`.

## Submit to Claude community directory

1. Push this repo publicly (already on GitHub).
2. Run `claude plugin validate ./plugins/anomalia` and fix issues.
3. Submit the **GitHub repo URL** at one of:
   - [platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit) (Console — individuals)
   - [claude.ai admin submissions](https://claude.ai/admin-settings/directory/submissions/plugins/new) (Team / Enterprise)
4. After approval, the plugin is pinned in [`anthropics/claude-plugins-community`](https://github.com/anthropics/claude-plugins-community) (catalog sync can take up to ~24h).
5. Later commits to this repo are re-screened automatically — no re-submit for routine updates.

Docs: [Submitting your plugin](https://claude.com/docs/plugins/submit) · [Plugins](https://code.claude.com/docs/en/plugins)

## Submit to Codex / ChatGPT Plugins Directory

1. OpenAI Platform org with **Apps Management → Write** and a **verified** developer/business identity.
2. Open the [plugin submission portal](https://developers.openai.com/plugins/deploy/submission).
3. Create plugin → prefer **With MCP** (skills + MCP):
   - MCP URL: `https://mcp.anomalia.so/mcp` (Universal)
   - Scan Tools, domain verification, tool annotations
   - Skills: upload the `plugins/anomalia/skills/` tree **or** import static skills from MCP if exposed
4. Fill listing (logo, privacy `https://www.anomalia.so/privacy`, terms `https://www.anomalia.so/terms`, support/website).
5. Add starter prompts + **5 positive / 3 negative** test cases; demo credentials without MFA if reviewers need login.
6. Submit for review → after approval, **publish** from the portal (not automatic).

Docs: [Submit plugins](https://developers.openai.com/plugins/deploy/submission) · [Build plugins](https://developers.openai.com/codex/plugins/build)

## Auth note

Remote MCP requires an Anomalia OAuth Bearer JWT (same session as `anomalia login`). Hosts that cannot attach Bearer should use local stdio MCP (`anomalia-mcp` / `bun run mcp`) after CLI login — see [`docs/mcp.md`](mcp.md).
