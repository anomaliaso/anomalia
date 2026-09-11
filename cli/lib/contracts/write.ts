import { z } from 'zod';
import type { BrandEndpoint } from './index';
import { QUERY_OPS } from './query';

/**
 * Il tetto sulle righe che UN update può toccare. Non è una preferenza: un update senza filtro è
 * la cancellazione che questo tool non espone, travestita, e un filtro largo la riproduce da capo.
 * Le righe si contano PRIMA di scrivere, quindi il tetto morde invece di essere una speranza.
 */
export const UPDATE_MAX_ROWS = 50;

const Filter = z.object({
  column: z.string().describe('A bare column name'),
  op: z.enum(QUERY_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))]),
  negate: z.boolean().optional().describe('Invert this one filter: `is null` becomes `is not null`')
});

/**
 * `values` è di forma libera perché lo sono le tabelle: un `z.record` invece di un oggetto
 * tipizzato è la stessa scelta che `query` fa per le righe che restituisce, e per lo stesso motivo.
 * Chi sbaglia una colonna non lo scopre da qui ma dall'errore, che gliela elenca.
 */
const Values = z
  .record(z.string(), z.unknown())
  .describe('Column name → value. Only the columns you name are written.');

/**
 * QUI IL VERBO STA NEL NOME, E NON È ESTETICA.
 *
 * `destructiveHint` è un'annotazione PER TOOL — `destructiveHint: endpoint.destructive` in
 * `cli/mcp/tools/brand-content.ts` — e il protocollo non sa dire «distruttivo solo quando
 * `op = update`». Un solo `write(op: 'insert' | 'update')` avrebbe quindi due sole scelte, e
 * mentono entrambe: marcato distruttivo avvisa anche sugli insert, che non tolgono niente a
 * nessuno, e la gente impara a cliccare via l'avviso; marcato non distruttivo tace proprio sugli
 * update, che sostituiscono valori che c'erano. `docs/mcp-tools.md` §3 lo dimostra su `ads_action`.
 *
 * Due tool riportano l'annotazione a dire il vero su entrambi, e in più rimettono il verbo dove un
 * modello sceglie davvero: il nome, che legge PRIMA di aprire qualunque schema.
 */
export const INSERT_ROW = {
  tool: 'insert_row',
  title: 'Insert a row',
  description:
    'Add ONE row to any table, AS YOU: anon key plus your own session, so Postgres RLS decides ' +
    'whether that row may exist at all — there is no way to write into a brand you do not belong ' +
    'to. Table names are the ones `query` takes: call `query` with no `table` to list them, and ' +
    'with only a `table` to get a real row back, whose keys are the columns you can name here. ' +
    '`brand_id` is filled in with this brand for you; naming a different one is refused, not ' +
    'quietly corrected. It NEVER replaces anything: a row that already exists comes back as a ' +
    'collision that names the key you hit, and changing it is `update_row`. Use it for the things ' +
    'that have no tool of their own — an idea, a note, a row in a table nothing else writes. ' +
    'Free, and nothing is published.',
  method: 'POST',
  pathUnderBrand: '/rows',
  input: z
    .object({
      table: z.string().describe('Table name, bare. The same names `query` reads.'),
      values: Values
    })
    .strict(),
  output: z.object({
    table: z.string().optional(),
    row: z.record(z.string(), z.unknown()).optional(),
    inserted: z.number().optional(),
    note: z.string().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    fix: z.string().optional(),
    columns_available: z.array(z.string()).optional()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const UPDATE_ROW = {
  tool: 'update_row',
  title: 'Update rows',
  description:
    'Change columns on rows that ALREADY EXIST, as you. ONLY the columns you send are touched — ' +
    'the rest of the row is left exactly as it was, so a partial change is safe by construction ' +
    'and you never have to resend fields you are not changing. `where` is REQUIRED and may not be ' +
    'empty: an update with no filter rewrites every row you can reach. At most ' +
    `${UPDATE_MAX_ROWS} rows per call, counted BEFORE anything is written and reported back to ` +
    'you. THE OLD VALUES ARE GONE — read the rows with `query` first when you are not certain ' +
    'which ones you are about to hit. It cannot delete a row: deleting has its own named tools. ' +
    'Free.',
  method: 'PUT',
  pathUnderBrand: '/rows',
  input: z
    .object({
      table: z.string().describe('Table name, bare. The same names `query` reads.'),
      where: z
        .array(Filter)
        .min(1, 'where may not be empty: an update with no filter rewrites every row of the table')
        .describe('Filters, ANDed. Required: without one this would rewrite the whole table.'),
      values: Values
    })
    .strict(),
  output: z.object({
    table: z.string().optional(),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    updated: z.number().optional(),
    matched: z.number().optional(),
    note: z.string().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    fix: z.string().optional(),
    columns_available: z.array(z.string()).optional()
  }),
  failures: [],
  destructive: true
} satisfies BrandEndpoint;
