import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import { resolvePostId, withAuth } from '../util.ts';

const slug = z.string().min(1).describe('Brand URL slug');

export function registerBrandTools(server: McpServer) {
  server.registerTool(
    'get_dashboard',
    {
      title: 'Brand dashboard',
      description: 'Full brand overview: pending count, plan, products, accounts, kit, recent autopilot runs.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => withAuth((token) => api.getBrand(token, slug)),
  );

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
    'get_analytics',
    {
      title: 'Analytics',
      description: 'Brand analytics: totals, engagement, recent activity.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => withAuth((token) => api.getAnalytics(token, slug)),
  );

  server.registerTool(
    'get_calendar',
    {
      title: 'Calendar',
      description: 'Content calendar for a brand. Optional month as YYYY-MM.',
      inputSchema: z.object({
        slug,
        month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('Month YYYY-MM'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug, month }) => withAuth((token) => api.getCalendar(token, slug, month)),
  );

  server.registerTool(
    'get_gtm',
    {
      title: 'GTM roadmap',
      description: 'View the go-to-market roadmap for a brand.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => withAuth((token) => api.getGtm(token, slug)),
  );

  server.registerTool(
    'get_voice',
    {
      title: 'Voice rules',
      description: 'View brand voice framework and platform rules.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => withAuth((token) => api.getVoice(token, slug)),
  );

  server.registerTool(
    'update_voice',
    {
      title: 'Update voice',
      description: 'Patch brand voice fields (mood, tone, register, avoid list, platform instructions).',
      inputSchema: z.object({
        slug,
        mood: z.string().optional(),
        tone: z.string().optional(),
        register: z.number().optional(),
        emotion: z.string().optional(),
        character: z.string().optional(),
        syntax: z.string().optional(),
        avoid: z.array(z.string()).optional(),
        platform_instructions: z.record(z.string(), z.string()).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, ...data }) => withAuth((token) => api.updateVoice(token, slug, data)),
  );

  server.registerTool(
    'list_products',
    {
      title: 'List products',
      description: 'List products in the brand catalog.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => withAuth((token) => api.listProducts(token, slug)),
  );

  server.registerTool(
    'list_posts',
    {
      title: 'List posts',
      description:
        'List posts for a brand. Filter by status: pending_user, approved, scheduled, published, failed.',
      inputSchema: z.object({
        slug,
        status: z
          .enum(['pending_user', 'approved', 'scheduled', 'published', 'failed'])
          .optional()
          .describe('Optional status filter'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug, status }) => withAuth((token) => api.getPosts(token, slug, status)),
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
    'get_post',
    {
      title: 'Get post',
      description: 'Show a single post including carousel slides / media state. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1).describe('Post id or unambiguous prefix'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug, id }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        const media = await api.getPostMedia(token, slug, postId);
        return { id: postId, ...media };
      }),
  );

  server.registerTool(
    'edit_post',
    {
      title: 'Edit post',
      description:
        'Edit post fields without rendering (no credits). Editing a scheduled post re-syncs to Zernio. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1).describe('Post id or unambiguous prefix'),
        caption: z.string().optional(),
        title: z.string().optional(),
        link_url: z.string().nullable().optional(),
        subreddit: z.string().optional(),
        first_comment: z.string().optional(),
        image_prompt: z.string().optional(),
        format: z.string().optional(),
        slot: z.string().optional(),
        product_name: z.string().optional(),
        platforms: z.array(z.string()).optional(),
        media_url: z.string().nullable().optional().describe('Set null to clear image (text-only)'),
        platform_captions: z.record(z.string(), z.string()).nullable().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, id, ...patch }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        await api.updatePost(token, slug, postId, patch);
        return { ok: true, id: postId, patch };
      }),
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

  server.registerTool(
    'reschedule_post',
    {
      title: 'Reschedule post',
      description: 'Reschedule a post. scheduled_for is an ISO datetime. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
        scheduled_for: z.string().min(1).describe('ISO datetime, e.g. 2026-06-20T10:00'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, id, scheduled_for }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        return { id: postId, ...(await api.reschedulePost(token, slug, postId, scheduled_for)) };
      }),
  );

  server.registerTool(
    'render_post',
    {
      title: 'Render post image',
      description: 'Generate the missing image from the prompt. Bills a render. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, id }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        return { id: postId, ...(await api.renderPost(token, slug, postId)) };
      }),
  );

  server.registerTool(
    'regenerate_post_media',
    {
      title: 'Regenerate post media',
      description: 'Refine a single image with an instruction (bills one render). id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
        instruction: z.string().min(1).describe('How to refine the image'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, id, instruction }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        return {
          id: postId,
          ...(await api.postMedia(token, slug, postId, { action: 'regenerate', instruction })),
        };
      }),
  );

  server.registerTool(
    'regenerate_slide',
    {
      title: 'Regenerate carousel slide',
      description: 'Re-render one carousel slide (index 0 = cover). Bills a render. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
        index: z.number().int().min(0).describe('Slide index (0 = cover)'),
        instruction: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, id, index, instruction }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        return {
          id: postId,
          ...(await api.postMedia(token, slug, postId, { action: 'slide', index, instruction })),
        };
      }),
  );

  server.registerTool(
    'reorder_slides',
    {
      title: 'Reorder carousel slides',
      description: 'Reorder or drop slides without rendering. order is e.g. [0,2,1]. id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
        order: z.array(z.number().int().min(0)).min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, id, order }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        return {
          id: postId,
          ...(await api.postMedia(token, slug, postId, { action: 'reorder', order })),
        };
      }),
  );

  server.registerTool(
    'make_video',
    {
      title: 'Animate post to video',
      description:
        'Animate the cover into a video clip (also retries a video that fell back to a photo). id accepts a short prefix.',
      inputSchema: z.object({
        slug,
        id: z.string().min(1),
        duration: z.number().optional().describe('Duration in seconds, e.g. 6'),
        script: z.string().optional(),
        instruction: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, id, duration, script, instruction }) =>
      withAuth(async (token) => {
        const postId = await resolvePostId(token, slug, id);
        return {
          id: postId,
          ...(await api.postMedia(token, slug, postId, {
            action: 'video',
            duration,
            script,
            instruction,
          })),
        };
      }),
  );
}
