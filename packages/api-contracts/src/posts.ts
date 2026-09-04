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
  media_ids: z
    .array(z.string().min(1))
    .max(8)
    .optional()
    .describe(
      'Full ids from this brand media library (see list_media) — unlike a post id, a media id ' +
        'is never resolved from a prefix. An id that is not this brand is rejected: the post is ' +
        'never quietly created without it. At most 8: a ninth is refused, not dropped'
    ),
  title: z.string().optional().describe('Required for Reddit'),
  subreddit: z.string().optional(),
  link_url: z.string().optional()
}).strict();

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
    'Text-capable platforms only — instagram and tiktok need an image, youtube needs a video. ' +
    'Two different media failures: `media_not_found` (400) means the id is not this brand — ' +
    'check it with list_media, and pass the full id, never a prefix; `media_unavailable` (502) ' +
    'means the id is yours and Anomalia could not attach it, so retrying other ids is wasted ' +
    'work — retry later or leave the media out.',
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
    { error: 'invalid_scheduled_for', status: 400 },
    { error: 'media_not_found', status: 400 },
    { error: 'media_unavailable', status: 502 }
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
  }).strict(),
  output: z.array(PostRow),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

const PostStateRow = z.looseObject({
  status: z.string(),
  content_type: z.string().nullable(),
  format: z.string().nullable(),
  platform: z.string().nullable(),
  platforms: z.array(z.string()).nullable(),
  caption: z.string().nullable(),
  media_url: z.string().nullable(),
  is_carousel: z.boolean(),
  slide_count: z.number(),
  slides: z.array(z.record(z.string(), z.unknown())).nullable(),
  text_only: z.boolean()
});

const NotFound = z.object({ error: z.string() });

export const GET_POST = {
  tool: 'get_post',
  title: 'Get post',
  description: 'Show a single post including carousel slides / media state. id accepts a short prefix.',
  method: 'GET',
  pathUnderBrand: '/posts/:id/media',
  resource: 'post',
  input: z.object({}).strict(),
  output: z.union([PostStateRow, NotFound]),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const RESCHEDULE_POST = {
  tool: 'reschedule_post',
  title: 'Reschedule post',
  description: 'Reschedule a post. scheduled_for is an ISO datetime. id accepts a short prefix.',
  method: 'POST',
  pathUnderBrand: '/posts/:id/reschedule',
  resource: 'post',
  input: z.object({
    scheduled_for: z.string().min(1).describe('ISO datetime, e.g. 2026-06-20T10:00')
  }).strict(),
  output: z.object({
    ok: z.literal(true),
    scheduled_for: z.string(),
    scheduled_for_local: z.string(),
    noAccount: z.boolean().optional()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const RENDER_POST = {
  tool: 'render_post',
  title: 'Render post image',
  description: 'Generate the missing image from the prompt. Bills a render. id accepts a short prefix.',
  method: 'POST',
  pathUnderBrand: '/posts/:id/render',
  resource: 'post',
  input: z.object({}).strict(),
  output: z.union([
    z.object({ ok: z.literal(true), url: z.string().nullable(), error: z.string().nullable() }),
    z.object({ error: z.string(), url: z.string() })
  ]),
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
  }).strict(),
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

const MediaRow = z.object({
  id: z.string(),
  kind: z.string(),
  mime: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  signed_url: z.string().nullable(),
  created_at: z.string()
});

export const LIST_MEDIA = {
  tool: 'list_media',
  title: 'List brand media',
  description:
    'Assets already in the brand library, newest first, with a preview URL. Use an id from here ' +
    'as media_ids on create_post to reuse an asset instead of paying for a new render.',
  method: 'GET',
  pathUnderBrand: '/media',
  input: z
    .object({
      query: z.string().optional().describe('Free-text filter over title, description and tags'),
      limit: z.coerce.number().int().min(1).max(200).optional()
    })
    .strict(),
  output: z.object({ media: z.array(MediaRow) }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

const ImportMediaUrlInputSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .describe('Public https URL of an image (jpeg, png, webp, gif) or video (mp4, mov, webm)'),
    title: z.string().optional().describe('The name the asset carries in the library')
  })
  .strict();

const ImportMediaUrlResultSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  kind: z.string(),
  mime: z.string(),
  bytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  source_url: z.string(),
  signed_url: z.string().nullable()
});

export const IMPORT_MEDIA_URL = {
  tool: 'import_media_url',
  title: 'Import media from a URL',
  description:
    'Copy an image or video you produced elsewhere into the brand media library, then use the id ' +
    'it returns as media_ids on create_post. Anomalia calls no model and spends no credits: the ' +
    'file is copied, not generated. The URL must be public https and stay public across every ' +
    'redirect; jpeg, png, webp and gif up to 12MB, mp4, mov and webm up to 64MB. Anything else ' +
    'is refused and nothing is stored.',
  method: 'POST',
  pathUnderBrand: '/media',
  input: ImportMediaUrlInputSchema,
  output: ImportMediaUrlResultSchema,
  failures: [
    { error: 'not_https', status: 400 },
    { error: 'blocked_host', status: 400 },
    { error: 'fetch_failed', status: 400 },
    { error: 'unsupported_type', status: 415 },
    { error: 'too_large', status: 413 },
    { error: 'empty', status: 400 },
    { error: 'store_failed', status: 502 }
  ],
  destructive: false
} satisfies BrandEndpoint;
