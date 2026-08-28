import { api } from '../lib/api.ts';
import { loadSession, type StoredSession } from '../lib/auth.ts';
import { resolveByPrefix } from '../lib/select.ts';
import { getRequestAuth } from './context.ts';

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

export function ok(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const structured =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { result: data };
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
}

export function fail(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function sessionFromRequestAuth(): StoredSession | null {
  const ctx = getRequestAuth();
  if (!ctx) return null;
  return {
    access_token: ctx.access_token,
    refresh_token: '',
    expires_at: ctx.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user: ctx.user,
  };
}

/** Active OAuth session (HTTP Bearer or local CLI session file). */
export async function requireAuth(): Promise<
  { ok: true; session: StoredSession } | { ok: false; result: ToolResult }
> {
  const fromHttp = sessionFromRequestAuth();
  if (fromHttp) return { ok: true, session: fromHttp };

  const session = await loadSession();
  if (!session) {
    return {
      ok: false,
      result: fail(
        'Not authenticated. For local stdio/HTTP: call the `login` tool (browser OAuth) or run `anomalia login`. ' +
          'For remote HTTP (mcp.anomalia.so): send Authorization: Bearer <access_token> from your Anomalia OAuth session. ' +
          'No static API tokens are supported.',
      ),
    };
  }
  return { ok: true, session };
}

export async function withAuth(
  fn: (token: string, session: StoredSession) => Promise<unknown>,
): Promise<ToolResult> {
  const auth = await requireAuth();
  if (!auth.ok) return auth.result;
  try {
    const data = await fn(auth.session.access_token, auth.session);
    return ok(data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export async function resolvePostId(token: string, slug: string, idOrPrefix: string): Promise<string> {
  const posts = await api.getPosts(token, slug);
  const match = resolveByPrefix(posts, idOrPrefix);
  if (!match.ok) {
    if (match.reason === 'ambiguous') {
      throw new Error(
        `Ambiguous post id prefix "${idOrPrefix}" (${match.count} matches). Use a longer prefix.`,
      );
    }
    throw new Error(`No post found for id/prefix "${idOrPrefix}". List posts first.`);
  }
  return match.item.id;
}

export async function resolveArticleId(token: string, slug: string, idOrPrefix: string): Promise<string> {
  const { articles } = await api.getWeb(token, slug, 'all');
  const match = resolveByPrefix(articles, idOrPrefix);
  if (!match.ok) {
    if (match.reason === 'ambiguous') {
      throw new Error(
        `Ambiguous article id prefix "${idOrPrefix}" (${match.count} matches). Use a longer prefix.`,
      );
    }
    throw new Error(`No article found for id/prefix "${idOrPrefix}". List articles first.`);
  }
  return match.item.id;
}
