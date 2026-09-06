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
  'Reads cost nothing and change nothing. When no `get_*` or `list_*` answers the question, `query` reads any table as the signed-in person — a count, a join you do by hand, a fact nothing else exposes.',
  'Writing is explicit and separate: generating a picture or a clip creates nothing in the calendar, and nothing goes out until a post is approved. Whatever spends the brand’s credits says so in its own description; everything else is free.',
  'Changing an asset that exists is `refine_media` — picture or clip — not a second generation, which buys a different subject.',
  'Post and article ids accept short unambiguous prefixes from any list tool.',
  'Sign in with `login` (browser OAuth) or send `Authorization: Bearer <access_token>`. There are no API keys; locally the session file is shared with the `anomalia` CLI.'
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
