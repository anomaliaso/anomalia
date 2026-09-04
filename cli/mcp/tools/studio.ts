import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import { withAuth } from '../util.ts';

const slug = z.string().min(1).describe('Brand URL slug');

export function registerStudioTools(server: McpServer) {
    server.registerTool(
    'set_colors',
    {
      title: 'Set brand colors',
      description:
        'Set brand colors as hex values, e.g. ["#7c5cff","#ffffff"]. Three or six digits, up to 8 colours; the list replaces the whole palette.',
      inputSchema: z.object({
        slug,
        // Stessa forma che la rotta salva: un `#aabbccdd` che passa di qui e prende un 400 di la'
        // lascia l'agente convinto di aver salvato un colore. studio-writes.test.ts le confronta.
        colors: z.array(z.string().regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)).min(1).max(8),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, colors }) =>
      withAuth((token) =>
        api.updateColors(
          token,
          slug,
          colors.map((c) => (c.startsWith('#') ? c : `#${c}`)),
        ),
      ),
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add knowledge note',
      description: 'Add a knowledge document / note to the studio.',
      inputSchema: z.object({
        slug,
        text: z.string().min(1),
        title: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, text, title }) =>
      withAuth((token) => api.addDocument(token, slug, { title, content_text: text, kind: 'note' })),
  );

  server.registerTool(
    'add_person',
    {
      title: 'Add person',
      description:
        "Add a real person to the brand studio. Their face stays withheld from every generator until consent is attested, so `consent` must be true and only the user can state it.",
      inputSchema: z.object({
        slug,
        name: z.string().min(1),
        role: z.string().optional(),
        description: z.string().optional(),
        consent: z
          .boolean()
          .describe(
            "true ONLY when the USER has stated, in their own words, that they have this person's consent to use their likeness. Never infer it.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, name, role, description, consent }) =>
      withAuth((token) =>
        api.addPerson(token, slug, { name, role, description, kind: 'real', consent }),
      ),
  );

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
