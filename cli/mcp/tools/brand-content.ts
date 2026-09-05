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
          : endpoint.input.extend({ slug }),
        annotations: {
          readOnlyHint: endpoint.method === 'GET',
          destructiveHint: endpoint.destructive,
          ...(endpoint.openWorld ? { openWorldHint: true } : {}),
        },
      },
      async ({ slug: brandSlug, ...input }) =>
        withAuth(async (token) => {
          if (endpoint.resource === undefined) {
            return callEndpoint(endpoint, token, brandSlug as string, input);
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
      description:
        'How this brand is doing right now, in one short answer: how many posts wait for someone ' +
        'to approve them, whether the plan still has room, and how the last recurring jobs went. ' +
        'get_dashboard is the fuller picture. Reads only — no model, no credits.',
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
      description:
        'Say yes to every post waiting for approval, in one go — they are published or scheduled ' +
        'from that moment. This is the irreversible one: ask the person first unless they clearly ' +
        'said "approve them all". approve_post takes one at a time. No model, no credits.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug }) => withAuth((token) => api.approveAll(token, slug)),
  );

  server.registerTool(
    'approve_post',
    {
      title: 'Approve post',
      description:
        'Say yes to one post waiting for approval, so it goes out. Read it first with get_post — ' +
        'approving is what authorises distribution, and it does not come back. edit_post changes ' +
        'the copy before you do. id accepts a short prefix. No model, no credits.',
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
      description:
        'Put one post out NOW, skipping its scheduled time. There is no undo from here: what a ' +
        'platform has received is on the platform. reschedule_post moves it instead. id accepts a ' +
        'short prefix. No model, no credits.',
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
      description:
        'Throw away one post that has not gone out yet. It does not come back, and its copy goes ' +
        'with it. A post already published cannot be deleted from here. id accepts a short prefix.',
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
