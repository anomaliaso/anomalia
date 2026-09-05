import { z } from 'zod';
import type { BrandEndpoint } from './index';
import { QUERY_TABLES } from './query-tables';

export const QUERY_TABLE_NAMES = QUERY_TABLES.split(' ') as [string, ...string[]];

export const QUERY_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd'] as const;

export const QUERY_DEFAULT_ROWS = 20;
export const QUERY_MAX_ROWS = 100;

const Filter = z.object({
  column: z.string().describe('A bare column name'),
  op: z.enum(QUERY_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))])
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
    'Read ANY table in the database directly, AS YOU — the request runs with the anon key plus your ' +
    'own session, so Postgres RLS returns exactly the rows you would see in the app, and nothing more. ' +
    'READ ONLY: there is no SQL here. You name a table, columns and filters, and it issues one ' +
    'PostgREST read, so a write has nowhere to go — no INSERT, no CTE, no function call, nothing to ' +
    'attempt. Omit `table` to list every table you can name. Ask for a table with no `columns` to get ' +
    'real rows with every column: the keys of a row ARE the schema. One table per call — no joins, no ' +
    'embeds; read two tables and match the ids yourself. Reach for it when the answer needs a table ' +
    'nothing else exposes, a count, or a join you do by hand. Costs nothing.',
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
        .object({ column: z.string(), ascending: z.boolean().optional() })
        .optional()
        .describe('Sort. Descending when `ascending` is omitted.'),
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
