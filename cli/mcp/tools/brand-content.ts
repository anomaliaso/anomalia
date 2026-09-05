import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api, callEndpoint } from '../../lib/api.ts';
import {
  acceptsIdPrefix,
  BRAND_ENDPOINTS,
  BRAND_RESOURCES,
  type BrandResource,
} from '../../lib/contracts/index.ts';
import { resolvePostId, resolveResourceId, withAuth } from '../util.ts';

const slug = z.string().min(1).describe('Brand URL slug');

/**
 * Il registro dichiara una strada che non passa da un brand: qui diventa un `slug` che si può
 * omettere, e il campo lo dice da sé. Senza quella frase l'opzionale non si vede — un modello
 * riempie comunque un parametro che nessuno gli ha detto quando lasciare vuoto, e sceglie un
 * brand a caso, i cui crediti sono di qualcun altro.
 */
const optionalSlug = slug
  .optional()
  .describe('Brand URL slug. Optional here: omit it to run without a brand — the tool description says what changes.');

const resourceId = (resource: BrandResource) =>
  z.string().min(1).describe(`${BRAND_RESOURCES[resource]} id or unambiguous prefix`);

function registerDeclaredEndpoints(server: McpServer) {
  for (const endpoint of BRAND_ENDPOINTS) {
    const byPrefix = acceptsIdPrefix(endpoint);
    server.registerTool(
      endpoint.tool,
      {
        title: endpoint.title,
        description: endpoint.description,
        inputSchema: byPrefix
          ? endpoint.input.extend({ slug, id: resourceId(endpoint.resource) })
          : endpoint.input.extend({ slug: endpoint.pathWithoutBrand ? optionalSlug : slug }),
        annotations: {
          readOnlyHint: endpoint.method === 'GET',
          destructiveHint: endpoint.destructive,
          ...(endpoint.openWorld ? { openWorldHint: true } : {}),
        },
      },
      async ({ slug: brandSlug, ...input }) =>
        withAuth(async (token) => {
          if (endpoint.resource === undefined) {
            return callEndpoint(endpoint, token, (brandSlug as string | undefined) ?? null, input);
          }

          const { id, ...payload } = input as { id: string } & Record<string, unknown>;
          const resolved = byPrefix
            ? await resolveResourceId(endpoint.resource, token, brandSlug as string, id)
            : id;
          const body = await callEndpoint<Record<string, unknown>>(
            endpoint,
            token,
            brandSlug as string,
            payload,
            resolved,
          );
          return { id: resolved, ...body };
        }),
    );
  }
}

export function registerBrandTools(server: McpServer) {
  registerDeclaredEndpoints(server);

  server.registerTool(
    'get_status',
    {
      title: 'Brand status',
      description: 'Compact status: pending posts, quota signals, last runs.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) =>
      withAuth(async (token) => {
        const detail = await api.getBrand(token, slug);
        const pending = await api.getPosts(token, slug, 'pending_user');
        return {
          brand: detail.brand,
          pendingCount: detail.pendingCount,
          pendingPreview: pending.slice(0, 10).map((p) => ({
            id: p.id,
            platform: p.platform,
            status: p.status,
            caption: (p.caption ?? '').slice(0, 80),
            scheduled_for: p.scheduled_for,
          })),
          scheduledCount: detail.scheduledCount,
          publishedCount: detail.publishedCount,
          runs: detail.runs,
        };
      }),
  );

            server.registerTool(
    'approve_posts',
    {
      title: 'Approve all pending posts',
      description: 'Approve and publish all posts in pending_user status for a brand.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug }) => withAuth((token) => api.approveAll(token, slug)),
  );

  server.registerTool(
    'approve_post',
    {
      title: 'Approve post',
      description: 'Approve a single pending post. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, id }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        return { id: postId, ...(await api.approvePost(token, slug, postId)) };
      }),
  );

  server.registerTool(
    'publish_post',
    {
      title: 'Publish post',
      description: 'Publish a post immediately. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, id }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        return { id: postId, ...(await api.publishPost(token, slug, postId)) };
      }),
  );

  server.registerTool(
    'reject_post',
    {
      title: 'Reject / delete post',
      description: 'Delete a pending post. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, id }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        await api.deletePost(token, slug, postId);
        return { ok: true, id: postId, deleted: true };
      }),
  );
}
