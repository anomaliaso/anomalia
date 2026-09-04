import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from './tools/auth.ts';
import { registerBrandTools } from './tools/brand-content.ts';
import { registerPlanTools } from './tools/plan.ts';
import { registerStudioTools } from './tools/studio.ts';
import { registerWebTools } from './tools/web.ts';

export function createAnomaliaMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'anomalia',
      version: '0.1.0',
      description:
        'Anomalia social media AI autopilot — manage brands, posts, plans, studio, SEO/GEO, and blog via OAuth.',
    },
    {
      instructions: [
        'Auth: browser OAuth via the `login` tool (local stdio/HTTP) or Authorization: Bearer <access_token> (remote HTTP). No static API tokens.',
        'Local MCP shares ~/.config/anomalia/session.json with the Anomalia CLI.',
        'Always start with `list_brands` (or `whoami`) to learn brand slugs.',
        'Post and article ids accept short unambiguous prefixes from list tools.',
      ].join(' '),
    },
  );

  registerAuthTools(server);
  registerBrandTools(server);
  registerPlanTools(server);
  registerStudioTools(server);
  registerWebTools(server);

  return server;
}
