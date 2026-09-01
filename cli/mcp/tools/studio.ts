import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../../lib/api.ts';
import { withAuth } from '../util.ts';

const slug = z.string().min(1).describe('Brand URL slug');

export function registerStudioTools(server: McpServer) {
  server.registerTool(
    'get_studio',
    {
      title: 'Studio',
      description: 'Full studio dump: kit, people, documents, competitors, products, history summary.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => withAuth((token) => api.getStudio(token, slug)),
  );

  server.registerTool(
    'update_brand_kit',
    {
      title: 'Update brand kit',
      description: 'Update brand kit fields (about, category, audience, style, language).',
      inputSchema: z.object({
        slug,
        about: z.string().optional(),
        category: z.string().optional(),
        target_audience: z.string().optional(),
        brand_style: z.string().optional(),
        language: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, ...data }) => withAuth((token) => api.updateBrandKit(token, slug, data)),
  );

  server.registerTool(
    'set_colors',
    {
      title: 'Set brand colors',
      description: 'Set brand colors as hex values, e.g. ["#7c5cff","#ffffff"].',
      inputSchema: z.object({
        slug,
        colors: z.array(z.string().regex(/^#?[0-9a-fA-F]{3,8}$/)).min(1),
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
    'delete_document',
    {
      title: 'Delete studio document',
      description: 'Delete a knowledge document by UUID.',
      inputSchema: z.object({
        slug,
        id: z.string().uuid(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, id }) => withAuth((token) => api.deleteDocument(token, slug, id)),
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

  server.registerTool(
    'delete_person',
    {
      title: 'Delete person',
      description: 'Delete a studio person by UUID.',
      inputSchema: z.object({
        slug,
        id: z.string().uuid(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, id }) => withAuth((token) => api.deletePerson(token, slug, id)),
  );

  server.registerTool(
    'add_competitor',
    {
      title: 'Add competitor',
      description: 'Add a competitor to the studio.',
      inputSchema: z.object({
        slug,
        name: z.string().min(1),
        website: z.string().optional(),
        rationale: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ slug, name, website, rationale }) =>
      withAuth((token) => api.addCompetitor(token, slug, { name, website, rationale })),
  );

  server.registerTool(
    'delete_competitor',
    {
      title: 'Delete competitor',
      description: 'Delete a competitor by UUID.',
      inputSchema: z.object({
        slug,
        id: z.string().uuid(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ slug, id }) => withAuth((token) => api.deleteCompetitor(token, slug, id)),
  );

  server.registerTool(
    'research_competitors',
    {
      title: 'Research competitors',
      description: 'Run AI competitor research and add findings to the studio.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ slug }) => withAuth((token) => api.researchCompetitors(token, slug)),
  );

  server.registerTool(
    'sync_history',
    {
      title: 'Sync social history',
      description: 'Sync historical social posts into the studio.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ slug }) => withAuth((token) => api.syncHistory(token, slug)),
  );
}
