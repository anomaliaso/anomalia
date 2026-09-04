export const MCP_URL = 'https://mcp.anomalia.so/mcp';

// Il testo che finisce negli appunti è un prompt per una macchina, non copy della pagina: resta
// in inglese in tutte le lingue, e i comandi sono quelli veri (cli/skills/anomalia/references/mcp.md,
// cli/plugins/anomalia/.mcp.json, la guida in-app src/routes/v2/[brand]/McpGuide.svelte).
export const AGENT_INSTRUCTIONS = `Run my marketing through Anomalia (https://anomalia.so). You do the thinking and the
writing; Anomalia holds my brand's context, checks every post against the platform's
own rules, renders the images, keeps the calendar, publishes to my real accounts and
reads the numbers back.

1. Connect to it over MCP.

   Claude Code:
     claude mcp add --transport http anomalia ${MCP_URL}

   Claude Code / Codex, with the Anomalia skill bundled in:
     /plugin marketplace add anomaliaso/anomalia
     /plugin install anomalia@anomalia

   Any other MCP host (Claude, Cursor, ChatGPT) — add a remote server:
     {"mcpServers": {"anomalia": {"url": "${MCP_URL}"}}}

2. Sign in when the browser opens. OAuth is the only way in — there are no API keys.
   If I don't have an account yet, send me to https://anomalia.so to create one.

3. Then call list_brands to get my brand's slug, get_dashboard with that slug to see
   where things stand, and tell me what you would do this week.

Nothing you create goes live until I approve it.`;
