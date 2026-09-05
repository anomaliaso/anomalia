import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import {
  clearSession,
  loadSession,
  startBrowserLogin,
} from '../../lib/auth.ts';
import { getRequestAuth } from '../context.ts';
import { fail, ok, withAuth } from '../util.ts';

export function registerAuthTools(server: McpServer) {
  server.registerTool(
    'login',
    {
      title: 'Login',
      description:
        'Sign in, so every other Anomalia tool works. It opens the login page in a browser, waits ' +
        'for the person to agree, and keeps the session in ~/.config/anomalia/session.json — the ' +
        'same file the command line uses, so signing in once covers both. There are no API keys ' +
        'to paste. Call whoami to see who is already signed in.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async () => {
      try {
        const bearer = getRequestAuth();
        if (bearer) {
          return ok({
            alreadyAuthenticated: true,
            email: bearer.user.email,
            source: 'bearer',
            hint: 'Request already carries a Bearer access token. No browser login needed.',
          });
        }

        const existing = await loadSession();
        if (existing) {
          return ok({
            alreadyAuthenticated: true,
            email: existing.user.email,
            expiresAt: existing.expires_at,
            source: 'session',
            hint: 'Already signed in. Call logout first if you need to switch accounts.',
          });
        }

        if (process.env.VERCEL === '1' || process.env.MCP_REQUIRE_BEARER === '1') {
          return fail(
            'Browser login is not available on the remote MCP. Pass Authorization: Bearer <access_token> from your Anomalia OAuth session (same JWT stored by `anomalia login`).',
          );
        }

        const session = await startBrowserLogin((msg: string) => {
          // stdout is the MCP JSON-RPC channel — log only to stderr
          console.error(`[anomalia-mcp] ${msg}`);
        });

        return ok({
          authenticated: true,
          email: session.user.email,
          expiresAt: session.expires_at,
          source: 'session',
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    'logout',
    {
      title: 'Logout',
      description:
        'Sign out, so the next call has no account behind it. Use it to switch to a different ' +
        'person. It only clears the local session file — it deletes nothing in Anomalia.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async () => {
      clearSession();
      return ok({ loggedOut: true });
    },
  );

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Who is signed in right now, if anyone. Check it before doing anything on a brand, so you ' +
        'are not acting as the wrong person. Nothing signed in means login first.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const bearer = getRequestAuth();
      if (bearer) {
        return ok({
          authenticated: true,
          email: bearer.user.email,
          userId: bearer.user.id,
          source: 'bearer',
        });
      }
      const session = await loadSession();
      if (!session) {
        return ok({
          authenticated: false,
          hint: 'Call login (local) or send Authorization: Bearer <access_token> (remote HTTP).',
        });
      }
      return ok({
        authenticated: true,
        email: session.user.email,
        userId: session.user.id,
        expiresAt: session.expires_at,
        source: 'session',
      });
    },
  );

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
