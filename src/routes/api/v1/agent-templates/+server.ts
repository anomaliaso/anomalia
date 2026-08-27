import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { getAgentTemplate, listAgentTemplates } from '$lib/server/agent-templates';
import { isAgentTemplateCategory } from '$lib/agent-templates';

/**
 * The Agent Library, for the CLI and the MCP server.
 *
 * Deliberately unauthenticated: this is the same catalogue the public /agents directory
 * renders, it holds no brand data, and `anomalia agents` should work before you log in.
 *
 *   GET /api/v1/agent-templates                → every published agent
 *   GET /api/v1/agent-templates?slug=queue-…   → one agent
 *   GET /api/v1/agent-templates?category=seo   → one category
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
  const admin = createAdminClient();
  setHeaders({ 'cache-control': 'public, max-age=300' });

  const slug = (url.searchParams.get('slug') ?? '').trim();
  if (slug) {
    const template = await getAgentTemplate(admin, slug);
    if (!template) return json({ error: 'not_found' }, { status: 404 });
    return json({ agent: template });
  }

  const category = (url.searchParams.get('category') ?? '').trim();
  const all = await listAgentTemplates(admin);
  const agents = isAgentTemplateCategory(category)
    ? all.filter((a) => a.category === category)
    : all;
  return json({ agents, total: agents.length });
};
