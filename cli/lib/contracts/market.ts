import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const MARKET_FIELD_DEFAULT = 20;
export const MARKET_FIELD_MAX = 50;

const limitUpTo = (max: number, fallback: number) =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(max)
    .optional()
    .describe(`How many to return, ${fallback} by default, ${max} at most`);

const FieldTopics = z.object({
  queries: z.array(z.string()),
  hashtags: z.array(z.string())
});

const FieldPlaybook = z.object({
  summary: z.string(),
  hooks: z.array(z.object({ pattern: z.string(), example: z.string() })),
  tones: z.array(z.string()),
  fieldRagebait: z.number(),
  moves: z.array(
    z.object({ move: z.string(), why: z.string(), howToAdapt: z.string(), ragebait: z.number() })
  ),
  avoid: z.array(z.string()),
  postsSeen: z.number(),
  updatedAt: z.string()
});

const FieldTeardown = z.object({
  market_post_id: z.string(),
  tone_of_voice: z.string().nullable(),
  communication: z.string().nullable(),
  format: z.string().nullable(),
  hook_type: z.string().nullable(),
  spread_strategy: z.array(z.string()),
  ragebait: z.number(),
  ragebait_levers: z.array(z.string()),
  why_it_spread: z.string().nullable(),
  transferable: z.array(z.string()),
  avoid: z.string().nullable()
});

export const DIAGNOSE_RADAR = {
  tool: 'diagnose_radar',
  title: 'Radar diagnosis',
  description:
    'Why Radar finds nothing: fetches every configured source live and reports, per source, how ' +
    'many items came back or why it was skipped — source off, plan, platform toggle, endpoint ' +
    'error. It can take seconds per source. Free.',
  method: 'GET',
  pathUnderBrand: '/radar/diagnose',
  input: z.object({}).strict(),
  output: z.object({
    enabled: z.boolean(),
    plan: z.string().nullable(),
    proLeads: z.boolean(),
    scrapecreatorsConfigured: z.boolean(),
    platforms: z.record(z.string(), z.boolean()),
    engagePlatforms: z.array(z.string()),
    sources: z.array(
      z.object({
        kind: z.string(),
        value: z.string(),
        active: z.boolean(),
        allowedByPlan: z.boolean(),
        enabled: z.boolean(),
        platform: z.string().nullable(),
        items: z.number(),
        windowHours: z.number().optional(),
        sample: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
        skipped: z.string().optional(),
        error: z.string().optional()
      })
    ),
    note: z.string()
  }),
  failures: [],
  destructive: false,
  openWorld: true
} satisfies BrandEndpoint;

