import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from './tools/auth.ts';
import { registerBrandTools } from './tools/brand-content.ts';
import { registerPlanTools } from './tools/plan.ts';
import { registerStudioTools } from './tools/studio.ts';

/**
 * Il client la mostra da solo al handshake, una volta per sessione, PRIMA di ogni descrizione e
 * prima della skill. Quindi è la mappa del server — come è organizzato, cosa serve un brand,
 * cosa costa — non la ripetizione dei tool, che si leggono da soli poco dopo.
 *
 * `Always start with list_brands` stava qui, ed è stato eseguito alla lettera: l'agente lo
 * chiamava per qualunque cosa e poi sceglieva un brand a caso, spendendo i crediti di
 * un'organizzazione vera e scrivendo nella libreria di un cliente vero.
 */
export const MCP_INSTRUCTIONS = [
  'Anomalia runs social brands: posts, editorial plans, media, the brand’s own knowledge, SEO and its blog.',
  'Most tools act on ONE brand and need its `slug`, and `list_brands` is where slugs come from — but when you do not know which brand, ASK the person. Never call `list_brands` to pick one yourself: guessing spends a real organisation’s credits and writes into a real client’s library.',
  'Reads cost nothing and change nothing. `query` reads any table as the signed-in person — the read for plain rows; the `get_*`/`list_*` that remain aggregate, join, fetch live sources or apply plan rules. Always pass `columns`; its description says why.',
  'Retired into `query`: `list_articles`, `list_ideas`, `get_memory`, `get_appearance` — the skill names each table and filter.',
  'Writing is explicit and separate: generating a picture or a clip creates nothing in the calendar, and nothing goes out until a post is approved. Whatever spends the brand’s credits says so in its own description; everything else is free.',
  'Post and article ids accept short unambiguous prefixes — from a list tool, or from the ids `query` returns.',
  'Signing in is not a tool: over HTTP the host does the OAuth round and sends the Bearer token; locally run `anomalia login` once, the CLI and this server share one session file. No API keys.'
].join(' ');

export function createAnomaliaMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'anomalia',
      version: '0.1.0',
      description:
        'Anomalia social media AI autopilot — manage brands, posts, plans, studio, SEO/GEO, and blog via OAuth.',
    },
    { instructions: MCP_INSTRUCTIONS },
  );

  registerAuthTools(server);
  registerBrandTools(server);
  registerPlanTools(server);
  registerStudioTools(server);

  return server;
}
