import { z } from 'zod';
import type { BrandEndpoint } from './index';

// The deterministic half of planning: an agent that already wrote the plan or the week's rows
// deposits them here. Anomalia stores them and calls no model. The generating endpoints
// (propose_plan, plan_week) stay: this sits beside them, it does not replace them.
//
// These two constants mirror the app's PLAN_WEEKS and CADENCES, which live behind $lib and
// cannot be imported from a package. The route tests import both and fail if they diverge.

export const PLAN_CYCLE_WEEKS = 4;
export const PLAN_CADENCES = ['3/week', '5/week', 'daily'] as const;
const MAX_WEEK_SEEDS = 30;

const line = z.string().min(1);

const PlanWeekInput = z
  .object({
    theme: line.describe('The editorial theme tying the week together'),
    focus: line.describe('What the week concretely pushes'),
    content_mix: z
      .array(z.object({ type: line, count: z.number().int().min(1) }).strict())
      .min(1)
      .describe('Post types and how many of each. The counts are the volume the week produces'),
    rationale: z.string().optional(),
    brief: z.string().optional().describe('Operator direction for this week, kept verbatim'),
    products: z.array(line).optional().describe('Exact product titles this week must feature')
  })
  .strict();

const PlanGtmInput = z
  .object({
    stage: z.enum(['zero_to_one', 'growth']),
    summary: z.string(),
    platform_recs: z
      .array(
        z
          .object({
            platform: line,
            priority: z.enum(['primary', 'secondary', 'experiment']),
            why: z.string(),
            organic_potential: z.string()
          })
          .strict()
      )
      .optional(),
    plays: z.array(z.string()).optional()
  })
  .strict();

const SavePlanInputSchema = z
  .object({
    strategy: line.describe('The strategy document you wrote, in prose'),
    voice: z.object({ mood: line, tone: line, goal: line, personality: line }).strict(),
    cadence: z.enum(PLAN_CADENCES).describe('How a week is spread across days'),
    platform_mix: z
      .array(z.object({ platform: line, share: line, role: line }).strict())
      .min(1),
    gtm: PlanGtmInput.optional(),
    weeks: z
      .array(PlanWeekInput)
      .min(1)
      .max(PLAN_CYCLE_WEEKS)
      .describe(`Up to ${PLAN_CYCLE_WEEKS} weeks; a short cycle is padded with empty weeks`)
  })
  .strict();

const SavePlanResultSchema = z.object({
  ok: z.literal(true),
  plan_id: z.string(),
  status: z.literal('proposed'),
  weeks: z.number(),
  review_url: z.string()
});

export type SavePlanInput = z.infer<typeof SavePlanInputSchema>;
export type SavePlanResult = z.infer<typeof SavePlanResultSchema>;

export const SAVE_PLAN = {
  tool: 'save_plan',
  title: 'Save an editorial plan',
  description:
    'Store an editorial plan you wrote yourself. Anomalia calls no model and spends no credits. ' +
    'It lands as the pending proposal, exactly where propose_plan leaves a generated one: the ' +
    'brand active plan is left untouched and approve_plan remains the step that activates it. ' +
    'Saving replaces an earlier pending proposal.',
  method: 'POST',
  pathUnderBrand: '/editorial-plan/save',
  input: SavePlanInputSchema,
  output: SavePlanResultSchema,
  failures: [{ error: 'invalid_input', status: 400 }, { error: 'insert_failed', status: 500 }],
  destructive: false
} satisfies BrandEndpoint;

const WeekSeedInput = z
  .object({
    platform: line.describe('Primary publish target, e.g. "instagram"'),
    platforms: z.array(line).optional().describe('Full cross-post set; defaults to [platform]'),
    pillar: z.string().optional().describe('The content pillar this post serves'),
    format: z.string().optional().describe('single_image, carousel, video, text…'),
    media: z.enum(['image', 'text', 'link', 'video']).optional(),
    slide_count: z.number().int().min(2).max(20).optional().describe('Carousels only'),
    art_direction: z.string().optional().describe('The medium: comic, illustration, reportage…'),
    sourced_from: z.string().optional().describe('Where the situation comes from, URL included'),
    day: z.string().optional().describe('Day of week, e.g. "Tue"'),
    time: z.string().optional().describe('Time of day, e.g. "09:00"'),
    angle: line.describe('The intent the copywriter must serve'),
    subject: z.string().optional().describe('Main subject in frame'),
    setting: z.string().optional().describe('Location or environment'),
    props: z.string().optional().describe('Supporting objects and styling'),
    product: z.string().optional().describe('Exact product title, or omitted'),
    person: z.string().optional().describe('Exact name from the brand people list, or omitted'),
    title: z.string().optional().describe('Reddit title'),
    subreddit: z.string().optional(),
    link_url: z.string().optional(),
    hook: z.string().optional().describe('Video only: the spoken opening'),
    hook_visual: z.string().optional().describe('Video only: what happens on screen in second one'),
    hook_text: z.string().optional().describe('Video only: on-screen text over the first seconds'),
    body: z.string().optional().describe('Video only: problem, demo, proof'),
    cta: z.string().optional().describe('Video only: the closing ask'),
    ugc: z.boolean().optional().describe('Video only: handheld UGC instead of the cinematic default')
  })
  .strict();

const SaveWeekSeedsInputSchema = z
  .object({
    week_index: z
      .number()
      .int()
      .min(0)
      .max(PLAN_CYCLE_WEEKS - 1)
      .describe('Which week of the active editorial cycle these rows belong to'),
    theme: line.describe('The single editorial angle tying the week together'),
    rationale: z.string().optional().describe('Why this theme now'),
    do_dont: z.string().optional().describe('Guardrails for whoever writes the copy'),
    seeds: z.array(WeekSeedInput).min(1).max(MAX_WEEK_SEEDS)
  })
  .strict();

const SaveWeekSeedsResultSchema = z.object({
  ok: z.literal(true),
  draft_id: z.string(),
  week_index: z.number(),
  seeds_saved: z.number(),
  editorial_plan_id: z.string().nullable(),
  replaced: z.boolean(),
  review_url: z.string()
});

export type SaveWeekSeedsInput = z.infer<typeof SaveWeekSeedsInputSchema>;
export type SaveWeekSeedsResult = z.infer<typeof SaveWeekSeedsResultSchema>;

export const SAVE_WEEK_SEEDS = {
  tool: 'save_week_seeds',
  title: 'Save weekly content seeds',
  description:
    'Store the week rows you planned yourself — one per post, no copy and no image yet. ' +
    'Anomalia calls no model and spends no credits. The rows land as the week draft, exactly ' +
    'where plan_week leaves generated ones: the plan page shows them, they are editable, and ' +
    'produce_week is the separate (paid) step that turns them into posts. A brand keeps one ' +
    'draft, so saving replaces the one in review.',
  method: 'POST',
  pathUnderBrand: '/weekly-plan/seeds',
  input: SaveWeekSeedsInputSchema,
  output: SaveWeekSeedsResultSchema,
  failures: [
    { error: 'invalid_input', status: 400 },
    { error: 'no_seeds', status: 400 },
    { error: 'save_failed', status: 500 }
  ],
  destructive: false
} satisfies BrandEndpoint;

const NoInput = z.object({}).strict();
const Ok = z.object({ ok: z.literal(true) });

export const PROPOSE_PLAN = {
  tool: 'propose_plan',
  title: 'Propose editorial plan',
  description: 'Generate the first / a new editorial plan proposal.',
  method: 'POST',
  pathUnderBrand: '/editorial-plan/propose',
  input: NoInput,
  output: z.object({ ok: z.literal(true), plan: z.unknown() }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const REVISE_PLAN = {
  tool: 'revise_plan',
  title: 'Revise editorial plan',
  description: 'Request a revision of the proposed plan with feedback.',
  method: 'POST',
  pathUnderBrand: '/editorial-plan/revise',
  input: z.object({ feedback: z.string().min(1) }).strict(),
  output: z.object({ ok: z.literal(true), plan: z.unknown() }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const APPROVE_PLAN = {
  tool: 'approve_plan',
  title: 'Approve editorial plan',
  description: 'Approve the proposed editorial plan.',
  method: 'POST',
  pathUnderBrand: '/editorial-plan/approve',
  input: NoInput,
  output: Ok,
  failures: [],
  destructive: true
} satisfies BrandEndpoint;

export const DISCARD_PLAN = {
  tool: 'discard_plan',
  title: 'Discard editorial plan',
  description: 'Discard the proposed editorial plan.',
  method: 'POST',
  pathUnderBrand: '/editorial-plan/discard',
  input: NoInput,
  output: Ok,
  failures: [],
  destructive: true
} satisfies BrandEndpoint;

// La settimana si chiama `week` da quando esiste il tool. La rotta la scrive `week_index` nella
// sua documentazione pubblica e continua ad accettarlo: qui vive il nome che l'agente usa.
const week = z.number().int().min(0);

const NO_ACTIVE_PLAN = { error: 'No active editorial plan', status: 404 };
const WEEK_REQUIRED = { error: 'week_index is required', status: 400 };

export const SAVE_BRIEF = {
  tool: 'save_brief',
  title: 'Save week brief',
  description: 'Save the brief for an editorial week (0-based index). Optional featured products.',
  method: 'POST',
  pathUnderBrand: '/editorial-plan/save-brief',
  input: z
    .object({
      week,
      brief: z.string(),
      products: z.array(z.string()).optional().describe('Exact product names to feature')
    })
    .strict(),
  output: Ok,
  failures: [WEEK_REQUIRED, NO_ACTIVE_PLAN, { error: 'Invalid week_index', status: 400 }],
  destructive: false
} satisfies BrandEndpoint;

export const REPLAN_WEEK = {
  tool: 'replan_week',
  title: 'Replan week',
  description: 'Regenerate an editorial week from a brief.',
  method: 'POST',
  pathUnderBrand: '/editorial-plan/replan-week',
  input: z.object({ week, brief: z.string().min(1) }).strict(),
  output: z.object({ ok: z.literal(true), week: z.number() }),
  failures: [
    WEEK_REQUIRED,
    { error: 'brief is required', status: 400 },
    { error: 'no active editorial plan', status: 404 },
    { error: 'invalid week_index', status: 400 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const PLAN_WEEK = {
  tool: 'plan_week',
  title: 'Generate weekly seeds',
  description: 'Generate content seeds for a week (0-based index).',
  method: 'POST',
  pathUnderBrand: '/weekly-plan/plan',
  input: z.object({ week }).strict(),
  output: z.object({ ok: z.literal(true), draft: z.unknown() }),
  failures: [WEEK_REQUIRED, NO_ACTIVE_PLAN],
  destructive: false
} satisfies BrandEndpoint;
