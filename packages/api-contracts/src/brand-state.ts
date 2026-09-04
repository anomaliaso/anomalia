import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const GOALS_DEFAULT = 20;
export const GOALS_MAX = 100;

export const DOCTOR_GATE_STATUSES = ['pass', 'fail', 'unknown'] as const;
export const DOCTOR_LOOP_STATUSES = ['ok', 'blocked', 'waiting', 'failing', 'unknown'] as const;
export const GOAL_STATUSES = ['open', 'met', 'handed_back', 'abandoned'] as const;
export const GOAL_CRITERION_STATUSES = ['open', 'done', 'dropped'] as const;

export const DIAGNOSE_BRAND = {
  tool: 'diagnose_brand',
  title: 'Brand doctor',
  description:
    'Why this brand receives nothing from the AI. Per recurring cycle: the FIRST gate it fails, what has to happen for that gate to pass, and the last recorded outcome. Says which cycles it does not cover.',
  method: 'GET',
  pathUnderBrand: '/doctor',
  input: z.object({}).strict(),
  output: z.object({
    brand: z.object({
      name: z.string().nullable(),
      slug: z.string().nullable(),
      plan: z.string().nullable()
    }),
    generatedAt: z.string(),
    headline: z.string(),
    loops: z.array(
      z.object({
        loop: z.string(),
        schedule: z.string(),
        status: z.enum(DOCTOR_LOOP_STATUSES),
        blockedBy: z.string().nullable(),
        gates: z.array(
          z.object({
            id: z.string(),
            status: z.enum(DOCTOR_GATE_STATUSES),
            detail: z.string(),
            fix: z.string().optional()
          })
        ),
        lastRun: z
          .object({ at: z.string(), outcome: z.string(), reason: z.string().nullable() })
          .nullable()
      })
    ),
    notCovered: z.array(z.string())
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_GOALS = {
  tool: 'get_goals',
  title: 'Chat goals',
  description:
    'Goal mode, measured: how many goals were met on the first pass, how many went back to the person, how many automatic laps were spent, and the reason each chain stopped — plus the goals themselves with their diary.',
  method: 'GET',
  pathUnderBrand: '/goals',
  input: z
    .object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(GOALS_MAX)
        .optional()
        .describe(`How many goals, ${GOALS_DEFAULT} by default, ${GOALS_MAX} at most`),
      thread: z.string().min(1).optional().describe('Only the goals of one conversation')
    })
    .strict(),
  output: z.object({
    brand: z.string(),
    summary: z.object({
      goals: z.number(),
      open: z.number(),
      met: z.number(),
      handed_back: z.number(),
      abandoned: z.number(),
      met_first_pass: z.number(),
      laps: z.number(),
      stopped_by: z.record(z.string(), z.number()),
      criteria_done: z.number(),
      criteria_dropped: z.number(),
      criteria_open: z.number()
    }),
    goals: z.array(
      z.object({
        id: z.string(),
        statement: z.string(),
        status: z.enum(GOAL_STATUSES),
        source: z.string(),
        laps: z.number(),
        criteria: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            status: z.enum(GOAL_CRITERION_STATUSES),
            note: z.string().nullable().optional()
          })
        ),
        created_at: z.string(),
        closed_at: z.string().nullable(),
        closing_note: z.string().nullable(),
        events: z.array(
          z.object({
            kind: z.string(),
            reason: z.string().nullable(),
            actor: z.string(),
            progress: z.string(),
            closed_now: z.number(),
            laps: z.number(),
            queued: z.boolean().nullable(),
            at: z.string()
          })
        )
      })
    )
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
