import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const KNOWLEDGE_HITS_DEFAULT = 6;
export const KNOWLEDGE_HITS_MAX = 20;

/**
 * Il tetto per passo. Un chunk nasce a ~800 token: otto interi sono ~25.000 caratteri riversati
 * nella finestra di chi ha fatto una domanda sola. `truncated` dice che c'è dell'altro, e
 * `documentId` dice dove andarlo a prendere.
 */
export const KNOWLEDGE_EXCERPT_CHARS = 1500;

/** Lo stesso elenco chiuso di `COLLECTIONS` in `$lib/server/knowledge` — un test tiene i due allineati. */
export const KNOWLEDGE_COLLECTIONS = [
  'brand',
  'product',
  'commercial',
  'legal',
  'operations',
  'research'
] as const;

export type KnowledgeCollection = (typeof KNOWLEDGE_COLLECTIONS)[number];

export const SEARCH_KNOWLEDGE = {
  tool: 'search_knowledge',
  title: 'Search brand knowledge',
  description:
    "Ask the brand's own documents a question and get back the passages that answer it, each with the document and heading it came from. " +
    'Hybrid retrieval over what is already indexed: keywords first, and a single embedding of the question only when keywords come up short — no credits are spent and nothing is written. ' +
    `Each passage is cut at ${KNOWLEDGE_EXCERPT_CHARS} characters (\`truncated\` says when there is more); \`limit\` is ${KNOWLEDGE_HITS_DEFAULT} by default and ${KNOWLEDGE_HITS_MAX} at most. ` +
    'Narrow with `collection` when you know the shelf. An empty `hits` means the indexed corpus has no answer — which is not the same as the brand not knowing it, because a document still queued has nothing to find.',
  method: 'GET',
  pathUnderBrand: '/knowledge/search',
  input: z
    .object({
      query: z.string().min(1).describe("The question, phrased in the brand's own language"),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(KNOWLEDGE_HITS_MAX)
        .optional()
        .describe(`How many passages, ${KNOWLEDGE_HITS_DEFAULT} by default, ${KNOWLEDGE_HITS_MAX} at most`),
      collection: z
        .enum(KNOWLEDGE_COLLECTIONS)
        .optional()
        .describe('Restrict to one shelf of the corpus')
    })
    .strict(),
  output: z.object({
    query: z.string(),
    count: z.number(),
    hits: z.array(
      z.object({
        chunkId: z.string(),
        documentId: z.string(),
        title: z.string(),
        headingPath: z.string(),
        excerpt: z.string(),
        truncated: z.boolean(),
        score: z.number()
      })
    )
  }),
  failures: [{ error: 'query_required', status: 400 }],
  destructive: false
} satisfies BrandEndpoint;
