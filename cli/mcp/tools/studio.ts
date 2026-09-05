import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import { withAuth } from '../util.ts';

const slug = z.string().min(1).describe('Brand URL slug');

export function registerStudioTools(server: McpServer) {
    server.registerTool(
    'generate_person',
    {
      title: 'Generate AI person',
      description: 'Generate an AI persona for the brand (may bill image generation).',
      inputSchema: z.object({
        slug,
        name: z.string().min(1),
        role: z.string().optional(),
        gender: z.string().optional(),
        vibe: z.string().optional(),
        description: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, name, role, gender, vibe, description }) =>
      withAuth((token) =>
        api.addPerson(token, slug, {
          name,
          role,
          description,
          gender,
          vibe,
          kind: 'ai',
        }),
      ),
  );

    }
