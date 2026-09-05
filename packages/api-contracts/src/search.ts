import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const SEO_ACTION = {
  tool: 'seo_action',
  title: 'SEO action',
  description:
    'Do something about the brand\'s search ranking: `run` audits the website\'s technical ' +
    'health, `plan` drafts the improvements worth making, `more` appends further ones (say ' +
    'what you want in `guidance`), and `asset` or `article` writes one of them out — those ' +
    'two need the `initiativeId` they belong to. Every action here spends credits. get_seo ' +
    'reads the last result for free.',
  method: 'POST',
  pathUnderBrand: '/seo',
  input: z
    .object({
      action: z.enum(['run', 'plan', 'more', 'asset', 'article']),
      initiativeId: z.string().optional(),
      guidance: z.string().optional().describe('Optional guidance when action=more')
    })
    .strict(),
  output: z.looseObject({
    ok: z.boolean().optional(),
    error: z.string().optional(),
    grade: z.string().optional(),
    initiatives: z.number().optional(),
    added: z.number().optional(),
    generated: z.number().optional(),
    articleId: z.string().optional(),
    techScore: z.number().nullable().optional()
  }),
  failures: [{ error: 'credits_exhausted', status: 402 }],
  destructive: false
} satisfies BrandEndpoint;

export const GEO_ACTION = {
  tool: 'geo_action',
  title: 'GEO action',
  description:
    'Do something about whether AI assistants name this brand when someone asks: `audit` puts ' +
    'questions to ChatGPT, Perplexity and Google\'s AI and records what came back, `fix` ' +
    'writes the pages and blocks that would get it cited. Both spend credits. get_geo reads ' +
    'the last result for free, and list_audit_citations shows the questions and answers ' +
    'behind the number.',
  method: 'POST',
  pathUnderBrand: '/geo',
  input: z.object({ action: z.enum(['audit', 'fix']) }).strict(),
  output: z.looseObject({
    ok: z.boolean().optional(),
    techScore: z.number().nullable().optional(),
    shareOfVoice: z.number().optional(),
    generated: z.number().optional()
  }),
  failures: [{ error: 'credits_exhausted', status: 402 }],
  destructive: false
} satisfies BrandEndpoint;

export const REFRESH_KEYWORDS = {
  tool: 'refresh_keywords',
  title: 'Refresh keywords',
  description:
    'Redo the keyword research from scratch: which search terms this brand should write for, ' +
    'how hard each one is, and what to do about it. It spends credits and replaces the ' +
    'current set. get_keywords reads what is there now, for free.',
  method: 'POST',
  pathUnderBrand: '/keywords',
  input: z.object({}).strict(),
  output: z.object({ ok: z.literal(true), keywords: z.number() }),
  failures: [{ error: 'credits_exhausted', status: 402 }],
  destructive: false
} satisfies BrandEndpoint;
