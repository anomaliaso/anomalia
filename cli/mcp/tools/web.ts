import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import { resolveArticleId, withAuth } from '../util.ts';

const slug = z.string().min(1).describe('Brand URL slug');

export function registerWebTools(server: McpServer) {
  server.registerTool(
    'seo_action',
    {
      title: 'SEO action',
      description:
        'Run SEO actions: run (tech audit), plan, more (append initiatives), asset, article. For asset/article pass initiativeId.',
      inputSchema: z.object({
        slug,
        action: z.enum(['run', 'plan', 'more', 'asset', 'article']),
        initiativeId: z.string().optional(),
        guidance: z.string().optional().describe('Optional guidance when action=more'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, action, initiativeId, guidance }) =>
      withAuth((token) => api.seoAction(token, slug, { action, initiativeId, guidance })),
  );

  server.registerTool(
    'geo_action',
    {
      title: 'GEO action',
      description: 'Run GEO citation audit or generate fix artifacts.',
      inputSchema: z.object({
        slug,
        action: z.enum(['audit', 'fix']),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, action }) => withAuth((token) => api.geoAction(token, slug, action)),
  );

  server.registerTool(
    'refresh_keywords',
    {
      title: 'Refresh keywords',
      description: 'Regenerate keyword research for the brand.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug }) => withAuth((token) => api.refreshKeywords(token, slug)),
  );

  server.registerTool(
    'generate_article',
    {
      title: 'Generate article',
      description: 'Generate a blog article draft from a topic.',
      inputSchema: z.object({
        slug,
        topic: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, topic }) =>
      withAuth((token) => api.webAction(token, slug, { action: 'generate', topic })),
  );

  server.registerTool(
    'optimize_article',
    {
      title: 'Optimize article',
      description: 'Rewrite an article for SEO (meta title/description included). id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, id }) =>
      withAuth(async (token) => {
        const articleId = await resolveArticleId(token, slug, id);
        return {
          id: articleId,
          ...(await api.webAction(token, slug, { action: 'optimize', id: articleId })),
        };
      }),
  );

  server.registerTool(
    'publish_article',
    {
      title: 'Publish article',
      description: 'Publish a blog article. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, id }) =>
      withAuth(async (token) => {
        const articleId = await resolveArticleId(token, slug, id);
        return {
          id: articleId,
          ...(await api.webAction(token, slug, { action: 'publish', id: articleId })),
        };
      }),
  );

  server.registerTool(
    'unpublish_article',
    {
      title: 'Unpublish article',
      description: 'Unpublish a blog article. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, id }) =>
      withAuth(async (token) => {
        const articleId = await resolveArticleId(token, slug, id);
        return {
          id: articleId,
          ...(await api.webAction(token, slug, { action: 'unpublish', id: articleId })),
        };
      }),
  );

  server.registerTool(
    'delete_article',
    {
      title: 'Delete article',
      description: 'Delete a blog article. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, id }) =>
      withAuth(async (token) => {
        const articleId = await resolveArticleId(token, slug, id);
        return {
          id: articleId,
          ...(await api.webAction(token, slug, { action: 'delete', id: articleId })),
        };
      }),
  );

  server.registerTool(
    'ads_action',
    {
      title: 'Ads action',
      description:
        'Run an ads action. Common actions: sync, propose, create, reject, pause, resume, toggle, duplicate, delete. Pass campaignId; for a single creative add adId (and next active|paused for toggle). duplicate creates a paused copy as a new proposal; approve it to launch. Pass extra fields as needed.',
      inputSchema: z.object({
        slug,
        action: z.string().min(1),
        campaignId: z.string().optional(),
        extra: z.record(z.string(), z.unknown()).optional().describe('Additional action payload fields'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, action, campaignId, extra }) =>
      withAuth((token) =>
        api.adsAction(token, slug, { action, campaignId, ...(extra ?? {}) }),
      ),
  );

  server.registerTool(
    'chat',
    {
      title: 'Anomalia AI chat',
      description:
        'Natural-language assistant with full read/write access to the brand (same as the web chatbot / `anomalia ai`). Prefer specific tools for deterministic ops; use chat for multi-step or exploratory work.',
      inputSchema: z.object({
        slug,
        message: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ slug, message }) =>
      withAuth(async (token) => {
        const reply = await api.chat(token, slug, message);
        return { reply };
      }),
  );
}
