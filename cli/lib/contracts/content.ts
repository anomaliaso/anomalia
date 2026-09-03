import { z } from 'zod';
import type { BrandEndpoint } from './index';

const CheckContentInputSchema = z
  .object({
    platforms: z
      .array(z.string().min(1))
      .min(1)
      .describe('Where this would be published, e.g. ["instagram","x"]'),
    caption: z.string().describe('The copy you wrote. It is read, scored and returned untouched'),
    platform_captions: z
      .record(z.string(), z.string())
      .optional()
      .describe('Per-platform overrides: each platform is checked against the copy IT would publish'),
    media_ids: z
      .array(z.string().min(1))
      .max(8)
      .optional()
      .describe('Ids from this brand media library (see list_media). An id that is not this brand is reported'),
    title: z.string().optional().describe('Required for Reddit'),
    scheduled_for: z
      .string()
      .optional()
      .describe('Proposed publication instant, ISO. Without an offset it is read on the brand clock')
  })
  .strict();

const IssueSchema = z.object({
  code: z.string(),
  field: z.string(),
  detail: z.string()
});

const CheckContentResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(IssueSchema),
  warnings: z.array(IssueSchema),
  scores: z.array(
    z.object({
      platform: z.string(),
      index: z.number(),
      checks: z.array(
        z.object({
          id: z.string(),
          value: z.number(),
          weight: z.number(),
          note: z.string()
        })
      )
    })
  ),
  versions: z.object({ rules: z.number(), scorer: z.number() })
});

export type CheckContentInput = z.infer<typeof CheckContentInputSchema>;
export type CheckContentResult = z.infer<typeof CheckContentResultSchema>;

export const CHECK_CONTENT = {
  tool: 'check_content',
  title: 'Check content',
  description:
    'Run the checks Anomalia runs on its own copy against a spec you wrote, before you create ' +
    'anything. Returns blocking errors, warnings and a 0-100 quality score per platform, each ' +
    'naming the field to repair. Deterministic: it calls no model, spends no credits, writes ' +
    'nothing, and the same spec always returns the same verdict. Perceptual review of an image ' +
    'or a video is a separate, explicitly paid action — this never looks at pixels.',
  method: 'POST',
  pathUnderBrand: '/content/check',
  input: CheckContentInputSchema,
  output: CheckContentResultSchema,
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
