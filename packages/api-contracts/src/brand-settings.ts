import { z } from 'zod';
import type { BrandEndpoint } from './index';

/**
 * Le piattaforme su cui il prodotto lavora. L'elenco vero e' `PLATFORM_KEYS`
 * (`$lib/components/platform-meta`), che il contratto non puo' importare: un test dell'app tiene
 * i due allineati. `twitter` non e' qui di proposito — e' un alias storico di `x`, e un tool che
 * offre due nomi per la stessa piattaforma insegna il nome sbagliato.
 */
export const TARGET_PLATFORMS = [
  'instagram',
  'tiktok',
  'facebook',
  'linkedin',
  'x',
  'threads',
  'youtube',
  'bluesky',
  'reddit'
] as const;

export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

const platform = z.enum(TARGET_PLATFORMS);

const hashtags = z
  .partialRecord(platform, z.array(z.string()))
  .describe('Hashtags per platform. When set for a platform, the AI uses ONLY these');

const voiceExamples = z
  .array(z.string())
  .describe('Real past posts of the brand, one per entry, that the AI imitates for tone');

export const GET_BRAND_SETTINGS = {
  tool: 'get_brand_settings',
  title: 'Brand settings',
  description:
    'How this brand works: posting timezone, the platforms it publishes to (with the ones that ' +
    'actually have a connected account), the hashtags it allows per platform, and the past posts ' +
    'the AI imitates for tone. Read it before set_brand_settings — it carries the platform ' +
    'vocabulary and shows which targets have nowhere to publish yet.',
  method: 'GET',
  pathUnderBrand: '/settings/brand',
  input: z.object({}).strict(),
  output: z.object({
    brand: z.string(),
    timezone: z.string(),
    platforms: z.array(z.string()),
    platform_choices: z.array(z.string()),
    connected_platforms: z.array(z.string()),
    hashtags: z.record(z.string(), z.array(z.string())),
    voice_examples: z.array(z.string())
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const SET_BRAND_SETTINGS = {
  tool: 'set_brand_settings',
  title: 'Change how the brand works',
  description:
    'Change the posting timezone, the target platforms, the per-platform hashtags, or the voice ' +
    'examples. Only the fields you send change. `hashtags` and `voice_examples` REPLACE the whole ' +
    'list, so send the full list you want, not a delta; `[]` and `{}` clear one. Calls no model ' +
    'and spends no credits. ' +
    'Two consequences worth knowing before you call it. Changing `timezone` does NOT move posts ' +
    'that already have a time: they keep firing at the same absolute instant, so their local hour ' +
    'shifts by the offset difference — a post set for 18:00 in Rome reads as 12:00 once the brand ' +
    'moves to New York. Only new scheduling uses the new zone. Removing a platform from ' +
    '`platforms` does NOT cancel posts already scheduled on it: the target list decides what NEW ' +
    'posts are made for, never what publishes, and an existing post still goes out while its ' +
    'account is connected.',
  method: 'PUT',
  pathUnderBrand: '/settings/brand',
  input: z
    .object({
      timezone: z
        .string()
        .min(1)
        .optional()
        .describe('IANA zone, e.g. "Europe/Rome". Decides the local hour of every future slot'),
      platforms: z
        .array(platform)
        .optional()
        .describe('Platforms new posts are made for. An empty list leaves the planner no target'),
      hashtags: hashtags.optional(),
      voice_examples: voiceExamples.optional()
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    timezone: z.string(),
    platforms: z.array(z.string()),
    hashtags: z.record(z.string(), z.array(z.string())),
    voice_examples: z.array(z.string()),
    /** Piattaforme scelte che non hanno dove pubblicare: i post per loro restano fermi. */
    without_account: z.array(z.string())
  }),
  failures: [
    { error: 'no_fields', status: 400 },
    { error: 'unknown_timezone', status: 400 },
    { error: 'update_failed', status: 500 }
  ],
  destructive: false
} satisfies BrandEndpoint;
