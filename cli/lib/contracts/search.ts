import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const SEO_ACTION = {
  tool: 'seo_action',
  title: 'SEO action',
  description:
    'Run SEO actions: run (tech audit), plan, more (append initiatives), asset, article. For asset/article pass initiativeId.',
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
  description: 'Run GEO citation audit or generate fix artifacts.',
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
  description: 'Regenerate keyword research for the brand.',
  method: 'POST',
  pathUnderBrand: '/keywords',
  input: z.object({}).strict(),
  output: z.object({ ok: z.literal(true), keywords: z.number() }),
  failures: [{ error: 'credits_exhausted', status: 402 }],
  destructive: false
} satisfies BrandEndpoint;
