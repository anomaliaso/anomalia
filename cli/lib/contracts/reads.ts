import { z } from 'zod';
import type { BrandEndpoint } from './index';

const NoInput = z.object({}).strict();

const JsonObject = z.record(z.string(), z.unknown());

export const GET_PLAN = {
  tool: 'get_plan',
  title: 'Editorial plan',
  description: 'View active editorial plan and any pending proposal.',
  method: 'GET',
  pathUnderBrand: '/editorial-plan',
  input: NoInput,
  output: z.object({
    plan: JsonObject.nullable(),
    proposed: JsonObject.nullable(),
    proposedFeedback: z.string().nullable(),
    currentWeek: z.number().nullable(),
    quota: z.object({ used: z.number(), remaining: z.number() })
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_WEEKLY_PLAN = {
  tool: 'get_weekly_plan',
  title: 'Weekly plan',
  description: 'View weekly plan seeds and related posts.',
  method: 'GET',
  pathUnderBrand: '/weekly-plan',
  input: NoInput,
  output: z.object({
    plan: z
      .looseObject({
        cadence: z.string().nullable(),
        weeks: z.array(z.object({ index: z.number(), theme: z.string(), status: z.string() })),
        strategy: z.string().nullable()
      })
      .nullable(),
    currentWeekIdx: z.number().nullable(),
    posts: z.array(
      z.object({
        id: z.string(),
        platform: z.string().nullable(),
        caption: z.string().nullable(),
        status: z.string(),
        slot: z.string().nullable(),
        scheduled_for: z.string().nullable(),
        pillar: z.string().nullable(),
        format: z.string().nullable()
      })
    ),
    seeds: z.looseObject({ id: z.string(), editorial_week: z.number().nullable() }).nullable(),
    quota: z.object({ used: z.number(), max: z.number() })
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_STUDIO = {
  tool: 'get_studio',
  title: 'Studio',
  description: 'Full studio dump: kit, people, documents, competitors, products, history summary.',
  method: 'GET',
  pathUnderBrand: '/studio',
  input: NoInput,
  output: z.object({
    kit: JsonObject.nullable(),
    products: z.array(JsonObject),
    documents: z.array(JsonObject),
    history: z.array(JsonObject),
    people: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string().nullable(),
        kind: z.string(),
        description: z.string().nullable(),
        consent: z.boolean(),
        imageCount: z.number()
      })
    ),
    competitors: z.array(JsonObject),
    targetPlatforms: z.array(z.string()),
    platformInstructions: z.record(z.string(), z.string()),
    language: z.string(),
    studioPct: z.number()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_SEO = {
  tool: 'get_seo',
  title: 'SEO overview',
  description: 'Tech score, search performance, SEO grade and initiatives.',
  method: 'GET',
  pathUnderBrand: '/seo',
  input: NoInput,
  output: z.object({
    audit: JsonObject.nullable(),
    plan: JsonObject.nullable(),
    assets: z.record(z.string(), JsonObject),
    metrics: JsonObject
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_GEO = {
  tool: 'get_geo',
  title: 'GEO overview',
  description: 'AI visibility: share of voice, citations, ready fixes.',
  method: 'GET',
  pathUnderBrand: '/geo',
  input: NoInput,
  output: z.object({
    audit: JsonObject.nullable(),
    citability: z.unknown(),
    aiOverview: JsonObject.nullable(),
    trend: z.array(
      z.object({
        techScore: z.number().nullable(),
        shareOfVoice: z.number().nullable(),
        at: z.string()
      })
    ),
    artifacts: z.array(JsonObject)
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_KEYWORDS = {
  tool: 'get_keywords',
  title: 'Keywords',
  description: 'Keyword strategy: volume, difficulty, opportunity, action.',
  method: 'GET',
  pathUnderBrand: '/keywords',
  input: NoInput,
  output: z.object({
    strategy: JsonObject.nullable(),
    citations: z.array(JsonObject),
    updatedAt: z.string().nullable()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_ADS = {
  tool: 'get_ads',
  title: 'Ads overview',
  description: 'Ad campaigns summary, candidates, and connected ad accounts.',
  method: 'GET',
  pathUnderBrand: '/ads',
  input: NoInput,
  output: z.object({
    summary: z.looseObject({ campaigns: z.array(JsonObject), totals: JsonObject }),
    candidates: z.array(JsonObject),
    adAccounts: z.array(JsonObject)
  }),
  failures: [
    { error: 'ads_not_on_plan', status: 403 },
    { error: 'Not found', status: 404 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const LIST_ARTICLES = {
  tool: 'list_articles',
  title: 'List blog articles',
  description: 'List web/blog articles. status: draft, scheduled, published, or all.',
  method: 'GET',
  pathUnderBrand: '/web',
  input: z
    .object({ status: z.enum(['draft', 'scheduled', 'published', 'all']).optional() })
    .strict(),
  output: z.object({
    articles: z.array(
      z.object({
        id: z.string(),
        slug: z.string(),
        title: z.string(),
        meta_title: z.string().nullable(),
        meta_description: z.string().nullable(),
        status: z.string(),
        scheduled_for: z.string().nullable(),
        published_at: z.string().nullable(),
        source_initiative_id: z.string().nullable(),
        created_at: z.string()
      })
    )
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
