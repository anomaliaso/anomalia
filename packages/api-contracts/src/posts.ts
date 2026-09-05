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
  failures: [{ error: 'credits_exhausted', status: 402 }],
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
  // Short permanent link (/a/<code>), never the signed storage URL. What crosses this boundary is
  // meant to be handed on — pasted to a person, embedded, kept — and a signed URL survives none of
  // that: it expires in 2h and truncates inside an agent's output.
  url: z.string().nullable(),
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
  url: z.string().nullable()
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

/**
 * Un tetto solo per le alternative, non due che divergono: lo schema rifiuta oltre questo numero,
 * quindi il server non ha una seconda soglia da tenere allineata. È lo stesso ceiling che la
 * pagina Media generator applica alle sue varianti — ogni alternativa è un render pagato.
 */
export const MAX_MEDIA_ALTERNATIVES = 4;

const GeneratedMediaSchema = z.object({
  id: z.string(),
  kind: z.string(),
  mime: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  url: z.string().nullable()
});

export const GENERATE_MEDIA = {
  tool: 'generate_media',
  title: 'Generate media into the library',
  description:
    'PREFER generate_image or generate_video: they say what they do, and refining or motion ' +
    'control has its own tool. This one stays and keeps working, forwarding to those two. ' +
    'To pick the model, read get_media_models and pass model — for this call only. ' +
    'Generate a new image or video into the brand media library, then pass the id it returns as ' +
    'media_ids on create_post. THIS SPENDS CREDITS: every image is a paid render and every video ' +
    'is a paid clip, so ask for what you need and no more. It creates nothing in the calendar — ' +
    'generate alternatives, look at them with list_media, and attach only the one you keep. ' +
    'Images come back ready, up to ' + MAX_MEDIA_ALTERNATIVES + ' per call. A video takes minutes: ' +
    'it comes back as a job_id with status rendering, and check_media_job says when it landed — ' +
    'do not call this again for the same clip while one is still rendering.',
  method: 'POST',
  pathUnderBrand: '/media/generate',
  input: z
    .object({
      prompt: z.string().min(1).describe('What the image or video should show'),
      kind: z.enum(['image', 'video']).optional().describe('Defaults to image'),
      count: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_MEDIA_ALTERNATIVES)
        .optional()
        .describe(
          'How many alternatives to draw, images only, 1-' + MAX_MEDIA_ALTERNATIVES +
            '. Each one bills a render. Defaults to 1.'
        ),
      aspect_ratio: z.enum(['1:1', '4:5', '9:16', '16:9']).optional(),
      model: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Model id for THIS call only — it changes no brand setting. Omit to use the brand’s ' +
            'choice. Accepted ids come from get_media_models (slot imageModel for an image, ' +
            'videoModel for a video); anything else is refused as model_not_for_slot.'
        ),
      title: z.string().optional().describe('The name the asset carries in the library')
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    status: z.enum(['ready', 'rendering']),
    media: z.array(GeneratedMediaSchema),
    job_id: z.string().nullable(),
    model: z
      .string()
      .nullable()
      .describe('The model that ACTUALLY made it, after brand and platform defaults'),
    renders: z.number().describe('How many renders were BILLED; 0 for a video, which bills when the clip lands')
  }),
  failures: [
    { error: 'credits_exhausted', status: 402 },
    { error: 'model_not_for_slot', status: 400 },
    { error: 'video_budget_exhausted', status: 400 },
    { error: 'render_failed', status: 502 },
    { error: 'store_failed', status: 502 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const CHECK_MEDIA_JOB = {
  tool: 'check_media_job',
  title: 'Check a media generation job',
  description:
    'Where the videos generate_media started have got to, newest first. status is rendering while ' +
    'the clip is being made, done once it is in the library — and then media_id is the id ' +
    'create_post accepts as media_ids. failed says why. not_in_library means the clip was ' +
    'rendered and paid for but never filed, so there is no media_id and a second render buys ' +
    'a second copy. Calls no model and spends no credits.',
  method: 'GET',
  pathUnderBrand: '/media/generate',
  input: z
    .object({ job_id: z.string().optional().describe('One job; omit for the brand\'s recent ones') })
    .strict(),
  output: z.object({
    jobs: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        media_id: z.string().nullable(),
        error: z.string().nullable(),
        submitted_at: z.string().nullable()
      })
    )
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
// Ogni azione sui media ha la sua rotta: il corpo dice con che cosa farla, mai quale fare.
const RENDER_FAILURES = [
  { error: 'credits_exhausted', status: 402 },
  { error: 'write access required', status: 403 }
];

const MediaResult = z.looseObject({
  success: z.boolean().optional(),
  error: z.string().optional(),
  rendered: z.boolean().optional(),
  media_url: z.string().nullable().optional(),
  notes: z.string().optional()
});

export const REGENERATE_POST_MEDIA = {
  tool: 'regenerate_post_media',
  title: 'Regenerate post media',
  description:
    'Refine a single image with an instruction (bills one render). id accepts a short prefix.',
  method: 'POST',
  pathUnderBrand: '/posts/:id/media/regenerate',
  resource: 'post',
  input: z
    .object({ instruction: z.string().min(1).describe('How to refine the image') })
    .strict(),
  output: MediaResult,
  failures: [...RENDER_FAILURES, { error: 'Missing instruction or prompt', status: 400 }],
  destructive: false
} satisfies BrandEndpoint;

export const REGENERATE_SLIDE = {
  tool: 'regenerate_slide',
  title: 'Regenerate carousel slide',
  description:
    'Re-render one carousel slide (index 0 = cover). Bills a render. id accepts a short prefix.',
  method: 'POST',
  pathUnderBrand: '/posts/:id/media/slide',
  resource: 'post',
  input: z
    .object({
      index: z.number().int().min(0).describe('Slide index (0 = cover)'),
      instruction: z.string().min(1)
    })
    .strict(),
  output: z.looseObject({
    success: z.boolean().optional(),
    error: z.string().optional(),
    slide_index: z.number().optional(),
    rendered: z.boolean().optional()
  }),
  failures: [...RENDER_FAILURES, { error: 'Missing index', status: 400 }],
  destructive: false
} satisfies BrandEndpoint;

export const REORDER_SLIDES = {
  tool: 'reorder_slides',
  title: 'Reorder carousel slides',
  description:
    'Reorder or drop slides without rendering. order is e.g. [0,2,1]. id accepts a short prefix.',
  method: 'POST',
  pathUnderBrand: '/posts/:id/media/order',
  resource: 'post',
  input: z.object({ order: z.array(z.number().int().min(0)).min(1) }).strict(),
  output: z.looseObject({
    success: z.boolean().optional(),
    error: z.string().optional(),
    slide_count: z.number().optional()
  }),
  failures: [{ error: 'Missing order', status: 400 }],
  destructive: false
} satisfies BrandEndpoint;

export const MAKE_VIDEO = {
  tool: 'make_video',
  title: 'Animate post to video',
  description:
    'Animate the cover into a video clip (also retries a video that fell back to a photo). id ' +
    'accepts a short prefix.',
  method: 'POST',
  pathUnderBrand: '/posts/:id/media/video',
  resource: 'post',
  input: z
    .object({
      duration: z.number().optional().describe('Duration in seconds, e.g. 6'),
      script: z.string().optional(),
      instruction: z.string().optional()
    })
    .strict(),
  output: z.looseObject({
    success: z.boolean().optional(),
    error: z.string().optional(),
    video_render_status: z.string().optional(),
    video_note: z.string().optional(),
    duration_seconds: z.number().optional(),
    videos_left: z.number().optional(),
    remake: z.boolean().optional()
  }),
  failures: [
    ...RENDER_FAILURES,
    { error: 'Invalid aspectRatio. Use 9:16, 1:1, 16:9, 4:3, 3:4 or 21:9.', status: 400 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const EDIT_POST = {
  tool: 'edit_post',
  title: 'Edit post',
  description:
    'Edit post fields without rendering (no credits). Editing a scheduled post re-syncs to ' +
    'Zernio. id accepts a short prefix.',
  method: 'PUT',
  pathUnderBrand: '/posts/:id',
  resource: 'post',
  input: z
    .object({
      caption: z.string().optional(),
      title: z.string().optional(),
      link_url: z.string().nullable().optional(),
      subreddit: z.string().optional(),
      first_comment: z.string().optional(),
      image_prompt: z.string().optional(),
      format: z.string().optional(),
      slot: z.string().optional(),
      product_name: z.string().optional(),
      platforms: z.array(z.string()).optional(),
      media_url: z
        .string()
        .nullable()
        .optional()
        .describe('Set null to clear image (text-only)'),
      platform_captions: z.record(z.string(), z.string()).nullable().optional()
    })
    .strict(),
  // `patch` è quello che la rotta ha scritto davvero, filtrato sui campi che sa applicare: una
  // conferma, non l'eco della richiesta. Un campo che non esiste non ci finisce dentro.
  output: z.object({ ok: z.literal(true), patch: z.record(z.string(), z.unknown()) }),
  failures: [
    { error: 'No fields to update', status: 400 },
    { error: 'Post not found', status: 404 }
  ],
  destructive: false
} satisfies BrandEndpoint;

const AlternativesField = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_MEDIA_ALTERNATIVES)
  .optional()
  .describe(
    'How many alternatives to draw, 1-' + MAX_MEDIA_ALTERNATIVES + '. Each one bills a render. Defaults to 1.'
  );

/**
 * Il modello vale PER QUESTA CHIAMATA. La distinzione con `set_media_model` è la sola cosa che
 * conta qui e va letta senza ambiguità: quello è «d'ora in poi», questo è «per questa volta».
 * Sceglierne uno non deve lasciare dietro di sé una preferenza che nessuno ha chiesto.
 */
function modelField(slot: string) {
  return z
    .string()
    .min(1)
    .optional()
    .describe(
      'Model id for THIS call only — it changes no brand setting. Omit to use the brand’s ' +
        'choice. The ids this job accepts, and what each costs, come from get_media_models ' +
        '(slot ' + slot + '); anything else is refused as model_not_for_slot.'
    );
}

const ImageResult = z.object({
  ok: z.literal(true),
  media: z.array(GeneratedMediaSchema),
  model: z.string().nullable().describe('The model that ACTUALLY drew it, after brand and platform defaults — read it rather than assuming your request won'
    + "'" + 't'),
  renders: z
    .number()
    .describe('How many renders were BILLED. Can exceed the images returned: a render that fails downstream is still paid for.')
});

const MODEL_FAILURE = { error: 'model_not_for_slot', status: 400 } as const;

export const GENERATE_IMAGE = {
  tool: 'generate_image',
  title: 'Generate an image',
  description:
    'Draw a NEW image into the brand media library from a prompt, then pass the id it returns as ' +
    'media_ids on create_post. Call get_media_models first if you want to choose the model — ' +
    'pass it as model, for this call only, instead of set_media_model, which changes the brand ' +
    'default from now on. BILLS A RENDER PER IMAGE (about 8 credits each, and the model moves ' +
    'that). It creates nothing in the calendar, so ask for two or three alternatives, look at ' +
    'them with list_media, and attach only the one you keep. To change an image that already ' +
    'exists use refine_image: correcting one drawing is cheaper than redrawing until it is right.',
  method: 'POST',
  pathUnderBrand: '/media/images',
  input: z
    .object({
      prompt: z.string().min(1).describe('What the image should show'),
      count: AlternativesField,
      aspect_ratio: z.enum(['1:1', '4:5', '9:16', '16:9']).optional(),
      model: modelField('imageModel'),
      title: z.string().optional().describe('The name the asset carries in the library')
    })
    .strict(),
  output: ImageResult,
  failures: [
    { error: 'credits_exhausted', status: 402 },
    MODEL_FAILURE,
    { error: 'render_failed', status: 502 },
    { error: 'store_failed', status: 502 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const REFINE_IMAGE = {
  tool: 'refine_image',
  title: 'Refine an image',
  description:
    'Change an image that is already in the brand library — "make the background warmer", ' +
    '"remove the cup on the left" — and file the result as a NEW asset. The original is left ' +
    'untouched, so a refinement never destroys what it started from. BILLS A RENDER PER IMAGE ' +
    '(about 8 credits each). base_media_id comes from list_media and must belong to this brand. ' +
    'Say ' +
    'what should CHANGE, not what the whole picture should be: the source is the subject, the ' +
    'instruction is the edit. Refining has its own model — get_media_models, slot ' +
    'imageRefineModel — and model here applies to this call only. base_media_id takes a short prefix, like post ids do.',
  method: 'POST',
  pathUnderBrand: '/media/images/refine',
  input: z
    .object({
      base_media_id: z
        .string()
        .min(1)
        .describe('The library image to start from — an id from list_media, or an unambiguous prefix'),
      instruction: z.string().min(1).describe('What should change about it'),
      count: AlternativesField,
      model: modelField('imageRefineModel'),
      title: z.string().optional().describe('The name the new asset carries in the library')
    })
    .strict(),
  output: ImageResult,
  failures: [
    { error: 'credits_exhausted', status: 402 },
    MODEL_FAILURE,
    { error: 'source_not_found', status: 404 },
    { error: 'render_failed', status: 502 },
    { error: 'store_failed', status: 502 }
  ],
  destructive: false
} satisfies BrandEndpoint;

const VideoJobResult = z.object({
  ok: z.literal(true),
  status: z.literal('rendering'),
  job_id: z.string(),
  model: z.string().nullable().describe('The model that is filming it; null when the platform default chose'),
  duration_seconds: z
    .number()
    .nullable()
    .describe('The seconds ACTUALLY submitted. A clip is billed per second, so read this rather than assuming your request was taken.')
});

export const GENERATE_VIDEO = {
  tool: 'generate_video',
  title: 'Generate a video',
  description:
    'Film a NEW clip into the brand media library — from a prompt alone, or from an image you ' +
    'already have. TO ANIMATE A LIBRARY IMAGE, pass its id as base_media_id: that is how "animate ' +
    'this photo" works, and it needs no post. It creates nothing in the calendar; when the clip ' +
    'lands, pass its media_id to create_post as media_ids. THIS SPENDS CREDITS, and the model ' +
    'moves the bill by more than an order of magnitude — a light clip is around 12 credits and a ' +
    'heavy one around 210, so read get_media_models (slot videoModel from a prompt, ' +
    'videoImageModel when animating an image) and pass model for this call only. A clip takes ' +
    'minutes: this returns a job_id with status rendering, and check_media_job says when it ' +
    'landed. Do not call this again for the same clip while one is still rendering.',
  method: 'POST',
  pathUnderBrand: '/media/videos',
  input: z
    .object({
      prompt: z.string().min(1).describe('What the clip should show, or how the image should move'),
      base_media_id: z
        .string()
        .min(1)
        .optional()
        .describe(
          'A library IMAGE to animate, from list_media — an id or an unambiguous prefix. Omit to film from the prompt alone.'
        ),
      duration: z.coerce
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe(
          'Seconds. Each model accepts its own window and most will not go below 10 — a duration ' +
            'outside it is refused as duration_out_of_range naming the nearest it accepts, rather ' +
            'than quietly rounded up, because a clip is billed per second.'
        ),
      aspect_ratio: z.enum(['1:1', '9:16', '16:9']).optional(),
      model: modelField('videoModel, or videoImageModel when base_media_id is set'),
      title: z.string().optional().describe('The name the clip carries in the library')
    })
    .strict(),
  output: VideoJobResult,
  failures: [
    { error: 'credits_exhausted', status: 402 },
    MODEL_FAILURE,
    { error: 'video_budget_exhausted', status: 400 },
    { error: 'source_not_found', status: 404 },
    { error: 'source_not_an_image', status: 400 },
    { error: 'duration_out_of_range', status: 400 },
    { error: 'render_failed', status: 502 },
    { error: 'store_failed', status: 502 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const GENERATE_CAROUSEL = {
  tool: 'generate_carousel',
  title: 'Generate a carousel',
  description:
    'Draw a SERIES of images that read as one object, not N unrelated pictures, and file them in ' +
    'the brand media library. Slide 1 is the cover and must work at thumbnail size; every later ' +
    'slide advances the angle one concrete step and carries exactly one idea. BILLS A RENDER PER ' +
    'SLIDE, so a 5-slide carousel is five renders — ask for the count you mean. It creates nothing ' +
    'in the calendar: pass the ids to create_post as media_ids, in order. TO CHANGE ONE SLIDE use ' +
    'refine_image on that slide id, and put the continuity_tokens this returns back into your ' +
    'instruction — they are what holds the series together, and an edit that touches palette, ' +
    'light or the recurring motif without them takes that slide out of the set.',
  method: 'POST',
  pathUnderBrand: '/media/carousel',
  input: z
    .object({
      brief: z.string().min(1).describe('What the carousel should say, as a whole'),
      slides: z.coerce.number().int().min(3).max(8).optional().describe('How many slides. Each one bills a render.'),
      aspect_ratio: z.enum(['1:1', '4:5', '9:16', '16:9']).optional(),
      model: modelField('imageModel'),
      title: z.string().optional().describe('The name the slides carry in the library')
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    media: z.array(GeneratedMediaSchema).describe('The slides, in order — slide 1 first'),
    continuity_tokens: z
      .array(z.string())
      .describe('The literal tokens repeated in every slide. Put them back into a refine_image instruction or that slide leaves the series.'),
    model: z.string().nullable(),
    renders: z.number().describe('How many renders were BILLED — one per slide attempted')
  }),
  failures: [
    { error: 'credits_exhausted', status: 402 },
    MODEL_FAILURE,
    { error: 'plan_failed', status: 502 },
    { error: 'render_failed', status: 502 },
    { error: 'store_failed', status: 502 }
  ],
  destructive: false
} satisfies BrandEndpoint;
