import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import { withAuth } from '../util.ts';

const slug = z.string().min(1).describe('Brand URL slug');

export function registerPlanTools(server: McpServer) {
    server.registerTool(
    'produce_week',
    {
      title: 'Produce weekly seeds',
      description:
        'Turn this week\'s plan into actual posts — copy and images, one per seed. It spends ' +
        'credits, once per post. The posts land waiting for approval; nothing is published. ' +
        'plan_week or save_week_seeds is what puts the seeds there first, and get_weekly_plan ' +
        'shows them. row_index produces one seed only.',
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
