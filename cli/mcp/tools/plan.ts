import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import { withAuth } from '../util.ts';

const slug = z.string().min(1).describe('Brand URL slug');

export function registerPlanTools(server: McpServer) {
          server.registerTool(
    'save_brief',
    {
      title: 'Save week brief',
      description: 'Save the brief for an editorial week (0-based index). Optional featured products.',
      inputSchema: z.object({
        slug,
        week: z.number().int().min(0),
        brief: z.string(),
        products: z.array(z.string()).optional().describe('Exact product names to feature'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, week, brief, products }) =>
      withAuth((token) => api.saveBrief(token, slug, week, brief, products)),
  );

  server.registerTool(
    'replan_week',
    {
      title: 'Replan week',
      description: 'Regenerate an editorial week from a brief.',
      inputSchema: z.object({
        slug,
        week: z.number().int().min(0),
        brief: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, week, brief }) => withAuth((token) => api.replanWeek(token, slug, week, brief)),
  );

  server.registerTool(
    'plan_week',
    {
      title: 'Generate weekly seeds',
      description: 'Generate content seeds for a week (0-based index).',
      inputSchema: z.object({
        slug,
        week: z.number().int().min(0),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, week }) => withAuth((token) => api.planWeek(token, slug, week)),
  );

  server.registerTool(
    'produce_week',
    {
      title: 'Produce weekly seeds',
      description: 'Produce the current week seeds into posts. Uses the active seeds draft for the brand.',
      inputSchema: z.object({
        slug,
        week: z.number().int().min(0).optional().describe('Unused for API resolve — seeds draft is auto-detected'),
        row_index: z.number().int().min(0).optional().describe('Produce a single seed row only'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, row_index }) =>
      withAuth(async (token) => {
        const data = await api.getWeeklyPlan(token, slug);
        if (!data.seeds?.id) throw new Error('No weekly seeds draft found. Call plan_week first.');
        return api.produceWeek(token, slug, data.seeds.id, row_index);
      }),
  );
}
