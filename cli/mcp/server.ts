import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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
  'Anomalia runs social brands: posts, editorial plans, media, knowledge, SEO, blog.',
  'Most tools act on ONE brand and need its `slug`; `list_brands` is where slugs come from. When you do not know which brand, ASK — never call `list_brands` to pick one yourself: guessing spends a real organisation’s credits and writes into a real client’s library.',
  'Reads cost nothing and change nothing. `query` reads any table as the signed-in person — plain rows; the `get_*`/`list_*` that remain aggregate, join or fetch live. Always pass `columns`; its description says why.',
  'Retired into `query`: `list_articles`, `list_ideas`, `get_memory`, `get_appearance` — see the skill.',
  'Writing is explicit and separate: generating a picture or clip creates nothing in the calendar, and nothing goes out until a post is approved. Whatever spends credits says so in its own description; everything else is free.',
  'Changing an existing asset is `refine_media` — picture or clip — not a second generation, which buys a different subject.',
  'Post and article ids accept short unambiguous prefixes — from a list tool, or from the ids `query` returns.',
  'Signing in is not a tool: over HTTP the host does the OAuth round and sends the Bearer; locally run `anomalia login` once — the CLI and this server share one session file. No API keys.'
].join(' ');

type ListedTool = { inputSchema?: Record<string, unknown> };

function withoutKeysNoClientReads(result: unknown): unknown {
  const { tools } = result as { tools: ListedTool[] };

  return {
    tools: tools.map(({ inputSchema, ...tool }) => {
      const { $schema, ...schema } = inputSchema ?? {};
      return { ...tool, execution: undefined, inputSchema: schema };
    }),
  };
}

/**
 * L'SDK aggiunge a ogni tool due chiavi che nessun client legge, e le paghiamo a ogni sessione:
 * `$schema` dichiara il dialetto di uno schema che il protocollo dichiara già JSON Schema, e
 * `execution.taskSupport: 'forbidden'` è esattamente ciò che l'assenza del campo significa.
 * Erano 13.356 caratteri, il 10% di `tools/list`.
 *
 * Si decora l'unico punto in cui l'SDK installa il suo handler, prima che i tool lo creino.
 */
function trimListedTools(server: McpServer): void {
  const inner = server.server;
  const install = inner.setRequestHandler.bind(inner);

  inner.setRequestHandler = ((schema: unknown, handler: (...args: unknown[]) => unknown) => {
    if (schema !== ListToolsRequestSchema) return install(schema as never, handler as never);

    return install(schema as never, (async (...args: unknown[]) =>
      withoutKeysNoClientReads(await handler(...args))) as never);
  }) as typeof inner.setRequestHandler;
}

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

  trimListedTools(server);

  registerAuthTools(server);
  registerBrandTools(server);
  registerPlanTools(server);
  registerStudioTools(server);

  return server;
}
