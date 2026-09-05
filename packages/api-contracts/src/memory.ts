import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const MEMORY_ENTRIES_DEFAULT = 50;
export const MEMORY_ENTRIES_MAX = 200;

/** Quante voci si possono segnalare come usate in una volta. Un turno ne usa una manciata. */
export const MEMORY_USED_MAX = 50;

/** Lo stesso elenco chiuso di `MemoryCategory` in `$lib/server/brand-memory` — un test li allinea. */
export const MEMORY_CATEGORIES = [
  'voice',
  'constraint',
  'fact',
  'preference',
  'insight',
  'skill'
] as const;

/**
 * QUELLO CHE UN AGENTE PUÒ SCRIVERE, e la riga che manca è la regola: `voice` e `constraint`
 * governano tutto ciò che sta a valle — un modello che riscrive la voce è un cambio di marca in
 * una chiamata. Restano all'operatore, dalla sua pagina.
 */
export const AGENT_MEMORY_CATEGORIES = ['fact', 'preference', 'insight', 'skill'] as const;

export type AgentMemoryCategory = (typeof AGENT_MEMORY_CATEGORIES)[number];

export const SAVE_MEMORY = {
  tool: 'save_memory',
  title: 'Save to brand memory',
  description:
    'Record something you learned about this brand so the next conversation starts from it. ' +
    `Writable categories: ${AGENT_MEMORY_CATEGORIES.join(', ')}. \`voice\` and \`constraint\` are NOT writable here — they govern everything downstream and only the brand's own people set them. ` +
    'A `key` that already holds a DIFFERENT value answers 409 with both values and writes nothing: you take it to the person, you do not win by arriving last. Sending the same value again reinforces it. ' +
    'Entries land as brand knowledge, never scoped to a chat, and arrive with the confidence of something a model inferred rather than something a person stated.',
  method: 'POST',
  pathUnderBrand: '/memory',
  input: z
    .object({
      key: z.string().min(1).describe('Stable slug, e.g. "shipping_threshold" — reusing it reinforces'),
      value: z.string().min(1).describe('The knowledge itself. For a skill: first line = when to use it, then the steps'),
      category: z.enum(AGENT_MEMORY_CATEGORIES)
    })
    .strict(),
  output: z.object({
    ok: z.boolean(),
    id: z.string(),
    reinforced: z.boolean()
  }),
  failures: [
    { error: 'category_not_writable', status: 403 },
    { error: 'memory_conflict', status: 409 },
    { error: 'skill_limit_reached', status: 409 }
  ],
  destructive: false
} satisfies BrandEndpoint;

/**
 * I soli campi che una PATCH può riscrivere. `.strict()` non è cosmesi: il corpo finisce nel SET
 * di un update scopato per `brand_id`, quindi un campo di troppo — `brand_id` — sposta la riga
 * nel brand di un altro cliente invece di aggiornarla nel proprio.
 */
export const UPDATE_MEMORY_ENTRY = z
  .object({
    value: z.string().min(1).optional(),
    category: z.enum(MEMORY_CATEGORIES).optional(),
    confidence: z.number().min(0).max(1).optional(),
    pinned: z.boolean().optional(),
    importance: z.number().int().min(1).max(5).optional()
  })
  .strict();

export const RECORD_MEMORY_USED = {
  tool: 'record_memory_used',
  title: 'Report memory you used',
  description:
    'Say which memory entries actually shaped what you just produced. Call it after acting, with the ids you actually read — a handful, not everything. Read what the brand knows with query({ table: "brand_memory", columns: ["id","key","value","category","confidence"], where: [{column:"layer",op:"neq",value:"session"},{column:"agent",op:"is",value:null}], order: {column:"confidence",ascending:false} }). ' +
    'This is what keeps a working entry alive: entries that are never reported decay out of the prompts they were helping. ' +
    `Ids that do not belong to this brand are ignored. At most ${MEMORY_USED_MAX} per call.`,
  method: 'POST',
  pathUnderBrand: '/memory/used',
  input: z
    .object({
      ids: z
        .array(z.string().min(1))
        .min(1)
        .max(MEMORY_USED_MAX)
        .describe('Ids of the entries you actually used')
    })
    .strict(),
  output: z.object({
    ok: z.boolean(),
    counted: z.number()
  }),
  failures: [
    { error: 'ids_required', status: 400 },
    { error: 'too_many_ids', status: 400 }
  ],
  destructive: false
} satisfies BrandEndpoint;
