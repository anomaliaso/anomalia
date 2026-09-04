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
