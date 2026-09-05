import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import { withAuth } from '../util.ts';

/**
 * Non c'e' piu' un tool per autenticarsi, e non e' un taglio al conteggio.
 *
 * Su HTTP l'autenticazione e' del protocollo, non di un tool: `http-app.ts` serve
 * `/.well-known/oauth-protected-resource` e risponde 401 con `WWW-Authenticate: Bearer`, che e' il
 * giro che l'host fa da solo. `login` la' dentro RIFIUTAVA gia' (`VERCEL === '1'`), e `logout`
 * cancellava il file di sessione della macchina che esegue il server: da remoto l'unlink fallisce,
 * il `catch {}` se lo mangia, e rispondeva `{ loggedOut: true }` — un successo falso a ogni
 * chiamata. `whoami` funzionava, ma la domanda ha gia' risposta: su HTTP e' l'host ad aver scelto
 * l'account, su stdio la sessione e' quella della CLI, e `list_brands` dice su cosa si puo' agire.
 *
 * Su stdio si entra con `anomalia login` da terminale: stesso pacchetto, stesso `session.json`.
 */
export function registerAuthTools(server: McpServer) {
  // Resta a mano, ed è l'unico: `GET /api/v1/brands` non ha un brand sotto cui stare, e il
  // registry è scoped sul brand. Un secondo registro per un endpoint solo costa più di questo.
  server.registerTool(
    'list_brands',
    {
      title: 'List brands',
      description:
        'Which brands this person can work on, and the slug each one is called by — every other ' +
        'tool needs that slug. Each row says the plan it is on, how many posts wait for approval, ' +
        'and whether its recurring jobs are running. Start here when you do not know the slug. ' +
        'Reads only — no model, no credits.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => withAuth(async (token) => api.listBrands(token)),
  );
}
