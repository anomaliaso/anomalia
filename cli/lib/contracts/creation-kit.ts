import { z } from 'zod';
import type { BrandEndpoint } from './index';

// Mirrors CONTENT_FORMATS in src/lib/content-formats.ts, which this package may not import.
// src/lib/server/creation-kit.test.ts fails if the two ever disagree.
export const KIT_FORMATS = ['single_image', 'carousel', 'text_post', 'link_post', 'video'] as const;

const GetCreationKitInputSchema = z
  .object({
    goal: z
      .string()
      .min(1)
      .max(300)
      .describe('What this post has to achieve, in one line. It selects the template and ranks the products and examples'),
    platforms: z
      .string()
      .min(1)
      .describe('Where it would be published, comma-separated: "instagram,linkedin"'),
    format: z.enum(KIT_FORMATS).describe('The format you intend to write')
  })
  .strict();

const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  body: z.string(),
  hooks: z.object({ id: z.string(), name: z.string(), body: z.string() }).optional(),
  playbook: z.string()
});

const GetCreationKitResultSchema = z.object({
  job: z.object({ goal: z.string(), platforms: z.array(z.string()), format: z.enum(KIT_FORMATS) }),
  versions: z.object({ kit: z.number() }),
  size_bytes: z.number(),
  budget_bytes: z.number(),
  trimmed: z.array(z.string()),
  constraints: z.object({
    platforms: z.array(
      z.object({
        platform: z.string(),
        char_limit: z.number().nullable(),
        needs_media: z.boolean(),
        video_only: z.boolean()
      })
    ),
    avoid: z.array(z.string())
  }),
  brand: z
    .object({
      name: z.string(),
      language: z.string().optional(),
      about: z.string().optional(),
      audience: z.string().optional(),
      products: z.array(z.object({ id: z.string(), title: z.string(), pricing: z.string().optional() })).optional(),
      people: z.array(z.object({ id: z.string(), name: z.string(), role: z.string().optional() })).optional()
    })
    .optional(),
  voice: z.object({ text: z.string() }).optional(),
  rubric: z
    .object({
      id: z.string().optional(),
      name: z.string(),
      format: z.string(),
      promise: z.string().optional(),
      cadence: z.string().optional(),
      art_direction: z.string().optional()
    })
    .optional(),
  template: TemplateSchema.optional(),
  calendar: z
    .object({
      occupied: z.array(
        z.object({
          scheduled_for: z.string(),
          platforms: z.array(z.string()),
          campaign: z.string().optional(),
          step: z.string().optional()
        })
      )
    })
    .optional(),
  week: z.object({ index: z.number(), theme: z.string() }).optional(),
  operator_edits: z.array(z.object({ before: z.string(), after: z.string() })).optional(),
  history: z
    .object({
      post_count: z.number(),
      best_times: z.array(z.string()),
      top_formats: z.array(z.string()),
      top_hashtags: z.array(z.string()),
      cadence: z.string().optional(),
      untested_hooks: z.array(z.string()),
      winners: z.array(z.object({ id: z.string(), platform: z.string(), opening: z.string() }))
    })
    .optional()
});

export type GetCreationKitInput = z.infer<typeof GetCreationKitInputSchema>;
export type GetCreationKitResult = z.infer<typeof GetCreationKitResultSchema>;

export const GET_CREATION_KIT = {
  tool: 'get_creation_kit',
  title: 'Creation kit',
  description:
    'The smallest brief you need before writing one post: what the platform allows, the ' +
    'brand\'s own facts and its approved voice, the checklist your copy will be judged ' +
    'against, ONE worked example chosen for this goal and format, the rewrites this brand\'s ' +
    'own team wrote, what has already worked here, and which calendar minutes are taken. It ' +
    'is a SELECTION, not the whole library: empty sections are absent, and the whole thing is ' +
    'capped so it never floods your context. Reads only — no model, no credits, nothing ' +
    'written. Pictures live in list_media; checking a draft before you create it is ' +
    'check_content.',
  method: 'GET',
  pathUnderBrand: '/creation-kit',
  input: GetCreationKitInputSchema,
  output: GetCreationKitResultSchema,
  failures: [{ error: 'no_platforms', status: 400 }],
  destructive: false
} satisfies BrandEndpoint;
