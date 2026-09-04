import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import { resolveArticleId, withAuth } from '../util.ts';

const slug = z.string().min(1).describe('Brand URL slug');

export function registerWebTools(server: McpServer) {
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

}
