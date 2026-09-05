import { z } from 'zod';
import type { BrandEndpoint } from './index';

const NoInput = z.object({}).strict();

const JsonObject = z.record(z.string(), z.unknown());

export const STUDIO_DOCUMENT_MODES = ['index', 'full'] as const;

export type StudioDocumentMode = (typeof STUDIO_DOCUMENT_MODES)[number];

export const GET_PLAN = {
  tool: 'get_plan',
  title: 'Editorial plan',
  description:
    'What this brand has decided to post about: the active editorial plan, plus any proposal ' +
    'still waiting for someone to approve it. Read it before writing anything, so the copy ' +
    'follows the plan already agreed. propose_plan writes a new one, approve_plan is what ' +
    'makes a proposal active. Reads only — no model, no credits.',
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
  description:
    'What is lined up for the coming weeks: the seeds planned for each week — one per ' +
    'intended post — and the posts already made from them. plan_week generates seeds, ' +
    'save_week_seeds stores ones you wrote yourself. Reads only — no model, no credits.',
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

/**
 * I nomi delle colonne che `getStudio` seleziona davvero. `looseObject` perché il dump porta
 * ancora quello che la tabella aggiunge domani: dichiarare i campi veri toglie l'indovinello
 * senza rompere chi legge un campo non ancora nominato qui.
 */
const StudioKit = z.looseObject({
  category: z.string().nullable(),
  about: z.string().nullable(),
  brand_style: z.string().nullable(),
  target_audience: z.string().nullable(),
  brand_colors: z.unknown(),
  theme_color: z.string().nullable(),
  favicon_url: z.string().nullable(),
  fonts: z.unknown(),
  logos: z.unknown(),
  ai_character: z.string().nullable(),
  ai_context: z.string().nullable(),
  ai_context_updated_at: z.string().nullable(),
  visual_style: z.unknown(),
  visual_style_locked: z.boolean().nullable(),
  content_pillars: z.unknown(),
  site_type: z.string().nullable(),
  images: z.unknown()
});

const StudioProduct = z.looseObject({
  id: z.string(),
  title: z.string().nullable(),
  pricing: z.unknown(),
  images: z.unknown(),
  featured: z.boolean().nullable()
});

/**
 * `status` e `chunkCount` sono la differenza fra CARICATO e DIGERITO: un documento `ready` con
 * zero chunk esiste nell'elenco e `search_knowledge` non lo vede. `get_knowledge_status` dà lo
 * stesso conto per l'intero brand, con il motivo di ogni guasto.
 */
const StudioDocument = z.looseObject({
  id: z.string(),
  kind: z.string(),
  title: z.string().nullable(),
  file_url: z.string().nullable(),
  file_name: z.string().nullable(),
  mime_type: z.string().nullable(),
  created_at: z.string(),
  status: z.string(),
  chunkCount: z.number(),
  textBytes: z.number(),
  /** Presente solo con `documents: "full"`. */
  content_text: z.string().nullable().optional()
});

const StudioHistoryPost = z.looseObject({
  id: z.string(),
  platform: z.string().nullable(),
  content: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  platform_post_url: z.string().nullable(),
  metrics: z.unknown(),
  published_at: z.string().nullable()
});

const StudioCompetitor = z.looseObject({
  id: z.string(),
  name: z.string(),
  website: z.string().nullable(),
  kind: z.string().nullable(),
  rationale: z.string().nullable(),
  source: z.string().nullable(),
  created_at: z.string()
});

export const GET_STUDIO = {
  tool: 'get_studio',
  title: 'Studio',
  description:
    'Everything the brand knows about itself, in one call: its own facts, the people who may ' +
    'appear in its content, the documents it has uploaded, its competitors, its products, and ' +
    'a summary of what it has posted before. Each document carries `status` and `chunkCount` ' +
    '(one that is not `ready` with at least one chunk exists here but is invisible to ' +
    '`search_knowledge`) and `textBytes`, which says how much text it holds. The text itself ' +
    'is NOT included: to answer a question, ask `search_knowledge` — it returns the passages ' +
    'that answer it with the document each came from, instead of the whole corpus. ' +
    '`documents: "full"` restores the complete text of every document; it exists for callers ' +
    'that were reading it before and is almost never what you want.',
  method: 'GET',
  pathUnderBrand: '/studio',
  input: z
    .object({
      documents: z
        .enum(STUDIO_DOCUMENT_MODES)
        .optional()
        .describe('`index` (default) lists documents without their text; `full` includes content_text')
    })
    .strict(),
  output: z.object({
    kit: StudioKit.nullable(),
    products: z.array(StudioProduct),
    documents: z.array(StudioDocument),
    history: z.array(StudioHistoryPost),
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
    competitors: z.array(StudioCompetitor),
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
  description:
    'How the brand\'s website is doing in Google: the technical score, the search performance, ' +
    'an overall grade, and the improvements worth making. Reads what was already measured — ' +
    'seo_action is what runs a fresh audit and spends credits. No model, no credits.',
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
  description:
    'Whether this brand gets named when someone asks ChatGPT, Perplexity or Google\'s AI: its ' +
    'share of voice, the answers that cited it, and fixes already written and ready to ' +
    'publish. Reads what was already measured — geo_action runs a fresh check and spends ' +
    'credits. No model, no credits.',
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
  description:
    'The search terms worth writing for: each one\'s monthly volume, how hard it is to rank ' +
    'for, the opportunity it carries, and what to do about it. refresh_keywords redoes the ' +
    'research and spends credits; this only reads. No model, no credits.',
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
  description:
    'The brand\'s paid campaigns: what is running, what has been proposed and is waiting, and ' +
    'which advertising accounts are connected. ads_action is what changes any of it. Reads ' +
    'only — no model, no credits.',
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

export const GET_ANALYTICS = {
  tool: 'get_analytics',
  title: 'Analytics',
  description:
    'How the brand\'s published posts are actually doing: totals, engagement, and recent ' +
    'activity. This is what happened after publishing, not the website\'s search traffic — ' +
    'that one is get_gsc. Reads only — no model, no credits.',
  method: 'GET',
  pathUnderBrand: '/analytics',
  input: NoInput,
  output: z.looseObject({
    total: z.number(),
    scheduled: z.number(),
    pending: z.number(),
    failed: z.number(),
    platforms: z.array(z.tuple([z.string(), z.number()])),
    upcomingPosts: z.array(JsonObject),
    recentActivity: z.array(JsonObject),
    socialPerformance: z.array(JsonObject),
    topPosts: z.array(JsonObject),
    products: z.number(),
    accounts: z.number()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_GTM = {
  tool: 'get_gtm',
  title: 'GTM roadmap',
  description:
    'The go-to-market roadmap: what this brand plans to do to reach its market, in order. ' +
    'Reads only — no model, no credits.',
  method: 'GET',
  pathUnderBrand: '/gtm',
  input: NoInput,
  output: z.object({
    gtm: JsonObject.nullable(),
    proposed: JsonObject.nullable(),
    proposedFeedback: z.string().nullable(),
    currentPhase: z.number().nullable(),
    phaseStatuses: z.array(z.enum(['done', 'now', 'next'])),
    horizons: z.array(z.string()),
    studioPct: z.number()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_VOICE = {
  tool: 'get_voice',
  title: 'Voice rules',
  description:
    'How this brand is supposed to sound: mood, tone, register, the words it avoids, and the ' +
    'rules that change from one platform to another. Read it before writing any copy — ' +
    'get_writing_skills is the craft, this is the brand. update_voice changes it. Reads only ' +
    '— no model, no credits.',
  method: 'GET',
  pathUnderBrand: '/voice',
  input: NoInput,
  output: z.object({
    platforms: z.array(z.string()),
    voiceMode: z.string(),
    voiceFramework: JsonObject,
    platformRules: z.record(z.string(), JsonObject),
    avoid: z.array(z.string()),
    platformInstructions: z.record(z.string(), z.string()),
    studioPct: z.number()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

// La dashboard è il brand stesso: `GET /api/v1/brands/:slug`, nessun segmento sotto. Con
// `pathUnderBrand` vuoto `pathFor` produce già quell'URL — non serve un secondo registro per gli
// endpoint fuori dal brand, ne resta fuori uno solo (`list_brands`, che di brand non ne ha uno).
export const GET_DASHBOARD = {
  tool: 'get_dashboard',
  title: 'Brand dashboard',
  description:
    'Where this brand stands right now, in one call: how many posts are waiting for approval, ' +
    'the active plan, the products, the connected social accounts, the brand\'s own facts, and ' +
    'how the recurring jobs went last time. Start here when you do not know what to look at. ' +
    'Reads only — no model, no credits.',
  method: 'GET',
  pathUnderBrand: '',
  input: z.object({}).strict(),
  output: z.looseObject({
    brand: z.looseObject({ id: z.string(), name: z.string(), slug: z.string() }),
    pendingCount: z.number(),
    runs: z.array(z.looseObject({ status: z.string(), posts_created: z.number() })),
    plan: z
      .looseObject({ id: z.string(), status: z.string(), cadence: z.string() })
      .nullable(),
    productCount: z.number(),
    accountCount: z.number(),
    scheduledCount: z.number(),
    publishedCount: z.number(),
    hasGtm: z.boolean(),
    hasContentPlans: z.boolean(),
    hasHistory: z.boolean(),
    kit: z.looseObject({ about: z.string().nullable() }).nullable(),
    logoUrl: z.string().nullable()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
