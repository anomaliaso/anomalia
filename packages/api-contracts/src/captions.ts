import { z } from 'zod';
import { TARGET_PLATFORMS } from './brand-settings';
import type { BrandEndpoint } from './index';

const platform = z.enum(TARGET_PLATFORMS);

export const CAPTION_FORMATS = ['single', 'thread'] as const;

const Caption = z.object({
  platform,
  parts: z
    .array(z.string())
    .describe('One entry for a single post; several, numbered "1/3", for a sequence'),
  limit: z.number().describe("The platform's character limit, which every part respects"),
  publishable: z
    .boolean()
    .describe(
      'false when this is a multi-post sequence: create_post publishes one post per platform, ' +
        'so a sequence has to be posted by hand'
    )
});

export const GENERATE_CAPTIONS = {
  tool: 'generate_captions',
  title: 'Generate captions',
  description:
    'Write captions — text only, no media, and NO post is created: pass a caption to create_post ' +
    'when you want to publish it. By default every platform gets its own caption, written for ' +
    'that platform and inside its character limit, instead of one text cut nine ways. Pass ' +
    'platforms to get only those, each written to its own limit with no extra shortening. ' +
    'format "thread" lets X and Threads come back as a numbered sequence of posts rather than ' +
    'one — good to paste by hand, but create_post publishes a single post per platform, so a ' +
    'sequence is not publishable from here. Uses the brand voice. Costs credits.',
  method: 'POST',
  pathUnderBrand: '/captions/generate',
  input: z
    .object({
      topic: z.string().min(1).describe('What the caption is about'),
      platforms: z
        .array(platform)
        .min(1)
        .optional()
        .describe('Only these platforms. Omitted, every platform gets one'),
      format: z
        .enum(CAPTION_FORMATS)
        .optional()
        .describe(
          '"single" (default) keeps every caption inside one post. "thread" lets X and Threads ' +
            'run past their limit as a numbered sequence'
        )
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    captions: z.array(Caption),
    cost_usd: z
      .number()
      .nullable()
      .describe(
        'What the gateway billed for this call, the same figure written to the usage ledger. ' +
          'null means no invoice came back: unknown, not free'
      )
  }),
  failures: [
    { error: 'invalid_input', status: 400 },
    { error: 'credits_exhausted', status: 402 },
    { error: 'no_captions', status: 502 }
  ],
  destructive: false
} satisfies BrandEndpoint;
