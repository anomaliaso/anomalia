import { z } from 'zod';
import type { BrandEndpoint } from './index';
import { QUERY_TABLES } from './query-tables';

export const QUERY_TABLE_NAMES = QUERY_TABLES.split(' ') as [string, ...string[]];

export const QUERY_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd'] as const;

export const QUERY_DEFAULT_ROWS = 20;
export const QUERY_MAX_ROWS = 200;

const Filter = z.object({
  column: z.string().describe('A bare column name'),
  op: z.enum(QUERY_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))]),
  negate: z.boolean().optional().describe('Invert this one filter: `is null` becomes `is not null`')
});

const Order = z.object({
  column: z.string(),
  ascending: z.boolean().optional(),
  nullsFirst: z.boolean().optional()
});

/**
 * `table` è un `enum` QUI e non nella chat, e la differenza è di prezzo, non di gusto: la
 * descrizione di un tool di chat si paga a ogni passo di ogni turno, mentre su MCP `tools/list` si
 * prende una volta per sessione. 149 nomi costano ~810 token una volta sola, e in cambio l'agente
 * non indovina `post_metrics` o `platforms` — tre PGRST205 in produzione, un giro sprecato l'uno.
 */
export const QUERY_DATABASE = {
  tool: 'query',
  title: 'Query the database',
  description:
    'READ THE BRAND: this is the read tool. Posts, media, articles, memory, competitors, products, ' +
    'plans, settings, audits — every table, AS YOU. The request runs with the anon key plus your own ' +
    'session, so Postgres RLS returns exactly the rows you would see in the app, and nothing more. ' +
    'READ ONLY: there is no SQL here. You name a table, columns and filters, and it issues one ' +
    'PostgREST read, so a write has nowhere to go. Omit `table` to list every table you can name. ' +
    'Ask for a table with no `columns` to get real rows with every column: the keys of a row ARE the ' +
    'schema. THEN NAME THE COLUMNS YOU NEED — the one rule that decides whether the answer is whole. ' +
    'Without `columns` every column comes back, the character cap drops whole rows to fit, and a long ' +
    'question gets a short answer; with five columns named the same read returns every row. ' +
    'NOTHING IS OUT OF REACH: `offset` is the next page and the reply tells you which offset resumes ' +
    'where it stopped, `count: \"exact\"` counts the matching rows for real when the number IS the ' +
    'answer, `negate` on a filter turns `is null` into `is not null`, `order` takes several columns ' +
    'with `nullsFirst`, and `embed` brings a related table along through its foreign key (RLS applies ' +
    'to it too) — an article with its category, author and tags in one call. Every cap that bites is ' +
    'named in `limits` on the way back; none of them is silent. ONE ROW IS A DOCUMENT: with ' +
    '`limit: 1` long text comes back whole, which is how you read an article before rewriting it. ' +
    'With many rows long values are cut at 2,000 chars and `limits` says in which columns. ' +
    'What this brand SELLS is the `products` table: one row per offer, with `title`, `kind`, ' +
    '`pricing`, `url`, `featured` and the `images` it carries. Free.',
  method: 'POST',
  pathUnderBrand: '/query',
  input: z
    .object({
      table: z
        .enum(QUERY_TABLE_NAMES)
        .optional()
        .describe('Table to read. Omit to list every table instead.'),
      columns: z
        .array(z.string())
        .optional()
        .describe('Bare column names. Omit for all columns — which is also how you discover them.'),
      where: z
        .array(Filter)
        .optional()
        .describe('Filters, ANDed together. `in` takes an array; `is` takes null/true/false.'),
      order: z
        .union([Order, z.array(Order)])
        .optional()
        .describe('Sort, one column or several in order. Descending when `ascending` is omitted.'),
      embed: z
        .array(z.object({ table: z.string(), columns: z.array(z.string()).optional() }))
        .optional()
        .describe('Related tables to bring along, followed through their foreign key. RLS applies to each.'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Rows to skip — the next page. `limits` tells you the offset that resumes the read.'),
      count: z
        .enum(['estimated', 'exact'])
        .optional()
        .describe('`exact` counts the matching rows for real. Default is the planner estimate.'),
      limit: z.number().int().positive().optional().describe(`Rows to return. ${QUERY_MAX_ROWS} at most.`)
    })
    .strict(),
  /**
   * Le righe sono di forma libera — è il punto del tool — e il rifiuto è un risultato, non un
   * 500: `query` risponde 200 con `error` dentro perché un agente deve poter leggere il motivo e
   * cambiare mossa, non ricevere un corpo vuoto con uno status.
   */
  output: z.object({
    table: z.string().optional(),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    returned: z.number().optional(),
    total: z.number().optional(),
    limits: z.string().optional(),
    tables: z.array(z.string()).optional(),
    count: z.number().optional(),
    note: z.string().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    fix: z.string().optional(),
    columns_available: z.array(z.string()).optional()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
