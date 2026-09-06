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

