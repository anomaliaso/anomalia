import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const POST_STATUSES = ['pending_user', 'approved', 'scheduled', 'published', 'failed'] as const;

const PostRow = z.object({
  id: z.string(),
  brand_id: z.string(),
  platform: z.string().nullable(),
  platforms: z.array(z.string()).nullable(),
  caption: z.string().nullable(),
  image_prompt: z.string().nullable(),
  slot: z.string().nullable(),
  media_url: z.string().nullable(),
  status: z.string(),
  content_type: z.string().nullable(),
  scheduled_for: z.string().nullable(),
  published_url: z.string().nullable(),
  product_name: z.string().nullable(),
  revisions_count: z.number().nullable(),
  pillar: z.string().nullable(),
  format: z.string().nullable(),
  created_at: z.string()
});

const CreatePostInputSchema = z.object({
  platforms: z.array(z.string().min(1)).min(1).describe('Text-capable platforms, e.g. ["linkedin","x"]'),
  caption: z.string().min(1).describe('The copy you wrote. Anomalia stores it as-is and writes nothing itself'),
  platform_captions: z
    .record(z.string(), z.string())
    .optional()
    .describe('Per-platform overrides of the caption'),
  scheduled_for: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Proposed publication instant, ISO. Without an offset it is read on the brand clock. ' +
        'It is a calendar proposal only: nothing is scheduled or published until the post is approved'
    ),
  title: z.string().optional().describe('Required for Reddit'),
  subreddit: z.string().optional(),
  link_url: z.string().optional()
});

const CreatePostResultSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  status: z.literal('pending_user'),
  scheduled_for: z.string().nullable(),
  scheduled_for_local: z.string().nullable(),
  slot: z.string().nullable(),
  review_url: z.string()
});

export type CreatePostInput = z.infer<typeof CreatePostInputSchema>;
export type CreatePostResult = z.infer<typeof CreatePostResultSchema>;

export const CREATE_POST = {
  tool: 'create_post',
  title: 'Create post',
  description:
    'Store copy you already wrote as one pending post for review. Anomalia calls no model and ' +
    'spends no credits. It does not publish and does not schedule: `scheduled_for` is the ' +
    'proposed calendar time, and approve_post remains the action that authorizes distribution. ' +
    'Text-capable platforms only — instagram and tiktok need an image, youtube needs a video.',
  method: 'POST',
  pathUnderBrand: '/posts',
  input: CreatePostInputSchema,
  output: CreatePostResultSchema,
  failures: [
    { error: 'no_platforms', status: 400 },
    { error: 'need_caption', status: 400 },
    { error: 'need_media', status: 400 },
    { error: 'need_video', status: 400 },
    { error: 'over_limit', status: 400 },
    { error: 'reddit_title', status: 400 },
    { error: 'too_soon', status: 400 },
    { error: 'invalid_scheduled_for', status: 400 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const LIST_POSTS = {
  tool: 'list_posts',
  title: 'List posts',
  description: 'Posts for a brand, newest first, with an optional status filter.',
  method: 'GET',
  pathUnderBrand: '/posts',
  input: z.object({
    status: z.enum(POST_STATUSES).optional().describe('Optional status filter')
  }),
  output: z.array(PostRow),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_CALENDAR = {
  tool: 'get_calendar',
  title: 'Calendar',
  description:
    'Content calendar for one month. Dated posts appear in the month they are dated for; ' +
    'undated drafts come back flagged isDraft.',
  method: 'GET',
  pathUnderBrand: '/calendar',
  input: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe('Month YYYY-MM')
  }),
  output: z.object({
    posts: z.array(z.record(z.string(), z.unknown())),
    year: z.number(),
    month: z.number(),
    monthLabel: z.string(),
    prevYM: z.string(),
    nextYM: z.string(),
    timezone: z.string()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
