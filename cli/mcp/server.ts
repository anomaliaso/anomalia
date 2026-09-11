import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { asTool } from '../lib/api.ts';
import { getRequestAuth } from './context.ts';
import { mcpLog } from './observability.ts';
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
  'Reads cost nothing and change nothing, and READING IS ONE TOOL: `query`. Posts, media, articles, memory, competitors, products, plans, settings, audits — every table, as the signed-in person. Name `columns` or the answer comes back short; `offset` is the next page and the reply tells you which; `count: "exact"` when the number IS the answer; `embed` brings a related table along. The skill has the query for each subject already written.',
  'Eight other reads exist and none is a select: `diagnose_brand`, `diagnose_radar`, `search_knowledge`, `get_writing_skills`, `get_creation_kit`, `get_gsc`, `get_ads`, `get_media_models`. Every other `get_*`/`list_*` you remember is now a `query`.',
  'Writing is explicit and separate: generating a picture or clip creates nothing in the calendar, and nothing goes out until a post is approved. Whatever spends credits says so in its own description; everything else is free.',
  'Changing an existing asset is `refine_media` — picture or clip — not a second generation, which buys a different subject.',
  'Post and article ids accept short unambiguous prefixes — the ids `query` returns are where they come from.',
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
 * Erano 10.948 caratteri, l'8,5% di `tools/list`.
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

type ToolHandler = (...args: unknown[]) => unknown;

function brandSlugOf(args: unknown[]): string | undefined {
  const input = args[0] as { slug?: unknown } | undefined;
  return typeof input?.slug === 'string' ? input.slug : undefined;
}

/**
 * OGNI CHIAMATA A UN TOOL LASCIA IL SUO NOME. `mcp_logs` ha il campo `tool_name` da sempre e
 * nessuno lo riempiva: quarantadue letture tolte e i tool riscritti sono stati decisi ragionando,
 * perché la tabella non sapeva dire quale tool fosse stato chiamato nemmeno una volta.
 *
 * Si decora `registerTool` una volta sola, prima che i quattro moduli registrino: un tool nuovo è
 * strumentato per il fatto di esistere, e la riga non dipende da chi si ricorda di scriverla.
 *
 * Lo stesso scope porta il nome fino alle chiamate HTTP che il tool fa (`asTool`), dove diventa
 * l'intestazione che lega la spesa in `ai_calls` al tool che l'ha causata.
 */
function recordToolCalls(server: McpServer): void {
  const register = server.registerTool.bind(server);

  server.registerTool = ((name: string, config: unknown, handler: ToolHandler) =>
    register(name as never, config as never, (async (...args: unknown[]) => {
      const started = Date.now();
      const common = {
        event: 'tool.call',
        toolName: name,
        brandSlug: brandSlugOf(args),
        userId: getRequestAuth()?.user.id,
      } as const;

      try {
        const result = (await asTool(name, () => handler(...args))) as { isError?: boolean };
        const failed = result?.isError === true;

        mcpLog({
          ...common,
          level: failed ? 'warn' : 'info',
          message: failed ? `${name} returned an error` : name,
          durationMs: Date.now() - started,
        });

        return result;
      } catch (e) {
        mcpLog({
          ...common,
          level: 'error',
          message: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - started,
          error: e,
        });
        throw e;
      }
    }) as never)) as typeof server.registerTool;
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
  recordToolCalls(server);

  registerAuthTools(server);
  registerBrandTools(server);
  registerPlanTools(server);
  registerStudioTools(server);

  return server;
}
