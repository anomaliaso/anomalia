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

/** Lo stesso elenco chiuso di `DOC_STATUSES` in `$lib/server/knowledge` — un test tiene i due allineati. */
export const KNOWLEDGE_DOC_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;

export const KNOWLEDGE_FAILURES_MAX = 20;

export const SEARCH_KNOWLEDGE = {
  tool: 'search_knowledge',
  title: 'Search brand knowledge',
  description:
    "Ask the brand's own documents a question and get back the passages that answer it, each with the document and heading it came from. " +
    'Hybrid retrieval over what is already indexed: keywords first, and a single embedding of the question only when keywords come up short — no credits are spent and nothing is written. ' +
    `Each passage is cut at ${KNOWLEDGE_EXCERPT_CHARS} characters (\`truncated\` says when there is more); \`limit\` is ${KNOWLEDGE_HITS_DEFAULT} by default and ${KNOWLEDGE_HITS_MAX} at most. ` +
    'Narrow with `collection` when you know the shelf. An empty `hits` means the indexed corpus has no answer — which is not the same as the brand not knowing it, so read `get_knowledge_status` before concluding anything: a document still queued has nothing to find.',
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

export const GET_KNOWLEDGE_STATUS = {
  tool: 'get_knowledge_status',
  title: 'Knowledge status',
  description:
    'Whether the brand\'s knowledge is USABLE, not just uploaded. Read it whenever `search_knowledge` comes back empty: an indexed corpus with no answer means the brand does not know the thing, a queued or failed one means nobody has read it yet — opposite situations needing opposite actions. ' +
    '`documents` counts the pipeline stage by stage (`pending` → `processing` → `ready` | `failed`) and `indexed` is the only number retrieval can see: a `ready` document with zero chunks is not searchable. ' +
    '`chunks.embedded` below `chunks.total` means retrieval is running on keywords alone, so paraphrases miss. ' +
    `\`failures\` names each broken document and WHY it broke (${KNOWLEDGE_FAILURES_MAX} at most), \`collections\` says which shelves \`search_knowledge\` can usefully narrow to, and \`sources\` says which connected apps feed the corpus and when each last synced. No credits, no writes.`,
  method: 'GET',
  pathUnderBrand: '/knowledge',
  input: z.object({}).strict(),
  output: z.object({
    documents: z.object({
      total: z.number(),
      indexed: z.number(),
      pending: z.number(),
      processing: z.number(),
      ready: z.number(),
      failed: z.number()
    }),
    chunks: z.object({ total: z.number(), embedded: z.number() }),
    collections: z.record(z.enum(KNOWLEDGE_COLLECTIONS), z.number()),
    failures: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        error: z.string(),
        attempts: z.number()
      })
    ),
    sources: z.array(
      z.object({
        provider: z.string(),
        displayName: z.string().nullable(),
        status: z.string(),
        lastSyncAt: z.string().nullable(),
        lastError: z.string().nullable(),
        docsIngested: z.number()
      })
    ),
    searchable: z.boolean()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
