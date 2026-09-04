import { z } from 'zod';
import type { BrandEndpoint } from './index';

/**
 * Le piattaforme che il Radar puo' battere e i tipi di fonte che un brand puo' aggiungere.
 * Gli elenchi veri sono `RADAR_PLATFORM_KEYS`, `RADAR_BASE_KINDS` e `RADAR_PRO_LEAD_KINDS`
 * (`$lib/plans`), che il contratto non puo' importare: un test dell'app tiene i tre allineati.
 *
 * I `PRO` sono separati dai `BASE` perche' la differenza non e' di gusto: sono le fonti che un
 * piano inferiore non puo' avere, e un tool che le offre a tutti insegna un 403.
 */
export const RADAR_PLATFORMS = ['gnews', 'reddit', 'threads', 'x', 'linkedin'] as const;

export const RADAR_BASE_SOURCE_KINDS = ['gnews_query', 'rss', 'subreddit', 'reddit_query'] as const;
export const RADAR_PRO_SOURCE_KINDS = ['threads_query', 'x_community', 'linkedin_query'] as const;
export const RADAR_SOURCE_KINDS = [
  ...RADAR_BASE_SOURCE_KINDS,
  ...RADAR_PRO_SOURCE_KINDS
] as const;

export type RadarPlatform = (typeof RADAR_PLATFORMS)[number];
export type RadarSourceKindName = (typeof RADAR_SOURCE_KINDS)[number];

const platform = z.enum(RADAR_PLATFORMS).describe('Which platform Radar may search');
const kind = z.enum(RADAR_SOURCE_KINDS).describe('What sort of source this is');

const value = z
  .string()
  .min(1)
  .describe(
    'The query, the feed URL, or the subreddit name. rss must be an http(s) URL; a subreddit is ' +
      'stored without its "r/"'
  );

const PLAN_REQUIRED: { error: string; status: number } = { error: 'plan_required', status: 403 };

export const GET_RADAR = {
  tool: 'get_radar',
  title: 'Radar sources',
  description:
    'Where Radar looks for this brand: which platforms are on, which sources are configured, ' +
    'and — the part you cannot guess — which source kinds this plan is allowed to use and how ' +
    'many sources are left. Threads, X and LinkedIn belong to the Pro plan: on a lower plan they ' +
    'read as locked here and adding one comes back plan_required.',
  method: 'GET',
  pathUnderBrand: '/settings/radar',
  input: z.object({}).strict(),
  output: z.object({
    brand: z.string(),
    plan: z.string().nullable(),
    platforms: z.array(
      z.object({
        platform: z.enum(RADAR_PLATFORMS),
        enabled: z.boolean(),
        plan_locked: z.boolean()
      })
    ),
    sources: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(RADAR_SOURCE_KINDS),
        value: z.string(),
        lang: z.string().nullable(),
        active: z.boolean()
      })
    ),
    allowed_kinds: z.array(z.string()),
    source_limit: z.number(),
    sources_used: z.number()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const SET_RADAR_PLATFORM = {
  tool: 'set_radar_platform',
  title: 'Turn a Radar platform on or off',
  description:
    'Switch one platform on or off for this brand’s Radar. Turning one off narrows what Radar ' +
    'finds; it deletes no source and no result already found. Threads, X and LinkedIn need the ' +
    'Pro plan and answer plan_required below it. Calls no model and spends no credits.',
  method: 'PUT',
  pathUnderBrand: '/settings/radar',
  input: z.object({ platform, enabled: z.boolean() }).strict(),
  output: z.object({
    ok: z.literal(true),
    platform: z.enum(RADAR_PLATFORMS),
    enabled: z.boolean()
  }),
  failures: [PLAN_REQUIRED, { error: 'update_failed', status: 500 }],
  destructive: false
} satisfies BrandEndpoint;

export const ADD_RADAR_SOURCE = {
  tool: 'add_radar_source',
  title: 'Add a Radar source',
  description:
    'Add one place for Radar to watch: a Google News query, an RSS feed, a subreddit, a Reddit / ' +
    'Threads / X / LinkedIn search. A source already there is left as it is rather than ' +
    'duplicated — the pair (kind, value) is its identity, and it is what remove_radar_source ' +
    'takes. Read get_radar first: the plan decides which kinds are allowed (plan_required) and ' +
    'how many sources fit (source_limit). Adding a source calls no model and spends no credits, ' +
    'but Radar reads it on every run from then on.',
  method: 'POST',
  pathUnderBrand: '/settings/radar/sources',
  input: z
    .object({
      kind,
      value,
      lang: z
        .string()
        .max(5)
        .optional()
        .describe('Language hint, e.g. "it" or "en". "auto" by default')
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    kind: z.enum(RADAR_SOURCE_KINDS),
    value: z.string(),
    lang: z.string(),
    /** Falso quando la fonte c'era gia': niente e' cambiato, e non e' un errore. */
    added: z.boolean(),
    sources_used: z.number(),
    source_limit: z.number()
  }),
  failures: [
    PLAN_REQUIRED,
    { error: 'source_limit', status: 403 },
    { error: 'invalid_value', status: 400 },
    { error: 'insert_failed', status: 500 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const REMOVE_RADAR_SOURCE = {
  tool: 'remove_radar_source',
  title: 'Remove a Radar source',
  description:
    'Delete one source, named by the same (kind, value) pair that added it. It does not come ' +
    'back, and Radar stops reading it. What it already found stays. A pair that is not there ' +
    'answers not_found rather than reporting a success that removed nothing.',
  method: 'POST',
  pathUnderBrand: '/settings/radar/sources/remove',
  input: z.object({ kind, value }).strict(),
  output: z.object({
    ok: z.literal(true),
    kind: z.enum(RADAR_SOURCE_KINDS),
    value: z.string(),
    sources_used: z.number()
  }),
  failures: [
    { error: 'not_found', status: 404 },
    { error: 'delete_failed', status: 500 }
  ],
  destructive: true
} satisfies BrandEndpoint;
