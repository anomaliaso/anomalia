import { z } from 'zod';
import type { BrandEndpoint } from './index';

/** Lo stesso elenco chiuso di `TEAM_AGENT_IDS` in `$lib/agent-owners` — un test tiene i due allineati. */
export const WRITING_DECK_AGENTS = ['content', 'analyst', 'web', 'ugc', 'motion', 'auto'] as const;

export type WritingDeckAgent = (typeof WRITING_DECK_AGENTS)[number];

export const WRITING_SKILL_SOURCES = ['product', 'brand'] as const;

const WritingSkill = z.object({
  name: z.string(),
  source: z.enum(WRITING_SKILL_SOURCES),
  description: z.string(),
  body: z.string(),
  references: z.array(z.string())
});

export const GET_WRITING_SKILLS = {
  tool: 'get_writing_skills',
  title: 'Writing skills',
  description:
    'READ THIS BEFORE WRITING ANY COPY FOR THE BRAND — a caption, a carousel, a script, an ' +
    'article, a bio. It returns the craft text Anomalia writes with: `humanizer` and `stop-slop` ' +
    'always, plus `social` or `seo-audit` depending on `agent`. It also returns the built-in ' +
    'production skills for that agent — the ones naming the gates that refuse a render — and this ' +
    'brand\'s OWN procedures, and a brand procedure overrules a product skill when they disagree. ' +
    'Bodies come inline; each skill lists its `references` by path without sending them, and ' +
    '`reference: "<skill>/<path>"` returns that one file alone. Free.',
  method: 'GET',
  pathUnderBrand: '/writing-skills',
  input: z
    .object({
      agent: z
        .enum(WRITING_DECK_AGENTS)
        .optional()
        .describe('Whose deck: content and ugc add `social`, web adds `seo-audit`. Omit for the writing deck alone'),
      reference: z
        .string()
        .min(1)
        .optional()
        .describe('Fetch one reference file instead of the deck, e.g. "social/references/platform-limits.md"')
    })
    .strict(),
  output: z.object({
    skills: z.array(WritingSkill),
    reference: z.object({ path: z.string(), content: z.string() }).nullable()
  }),
  failures: [{ error: 'reference_not_found', status: 404 }],
  destructive: false
} satisfies BrandEndpoint;
