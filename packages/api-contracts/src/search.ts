import { z } from 'zod';
import type { BrandEndpoint } from './index';

/**
 * Le azioni che la rotta `/seo` si ramifica su, e non una parola in più.
 *
 * Diceva `run` dove l'handler legge `audit`: l'intersezione fra i due elenchi non conteneva
 * l'audit, cioè il lavoro per cui il tool esiste. `audit` e non `run` perché è ciò che l'handler
 * ha sempre gestito, perché `geo_action` lo chiama già così, e perché a un modello che legge
 * l'enum dice cosa succede — `run` non dice niente.
 */
export const SEO_ACTIONS = ['audit', 'plan', 'more', 'asset', 'article'] as const;

export const SEO_ACTION = {
  tool: 'seo_action',
  title: 'SEO action',
  description:
    'Do something about the brand\'s search ranking: `audit` checks the website\'s technical ' +
    'health, `plan` drafts the improvements worth making, `more` appends further ones (say ' +
    'what you want in `guidance`), and `asset` or `article` writes one of them out — those ' +
    'two need the `initiativeId` they belong to. Every action here spends credits. get_seo ' +
    'reads the last result for free.',
  method: 'POST',
  pathUnderBrand: '/seo',
  input: z
    .object({
      action: z.enum(SEO_ACTIONS),
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
