import type { z } from 'zod';
import { ADS_ACTION, ADS_REMIX } from './ads';
import { GET_APPEARANCE, SET_APPEARANCE } from './appearance';
import { GET_AUTOMATIONS, SET_AUTOMATION } from './automations';
import { BILLING_PORTAL_LINK, CHECKOUT_LINK } from './billing';
import { GENERATE_CAPTIONS } from './captions';
import {
  DELETE_ARTICLE,
  GENERATE_ARTICLE,
  GET_ARTICLE,
  OPTIMIZE_ARTICLE,
  PUBLISH_ARTICLE,
  UNPUBLISH_ARTICLE,
  UPDATE_ARTICLE
} from './articles';
import { CHECK_CONTENT } from './content';
import { QUERY_DATABASE } from './query';
import { GET_CREATION_KIT } from './creation-kit';
import {
  GET_AUDIT_FINDINGS,
  LIST_AUDIT_CITATIONS,
  LIST_WEB_AUDITS,
  LIST_WEB_FIXES,
} from './evidence';
import {
  APPROVE_PLAN,
  DISCARD_PLAN,
  PLAN_CADENCES,
  PLAN_CYCLE_WEEKS,
  PLAN_WEEK,
  PROPOSE_PLAN,
  REPLAN_WEEK,
  REVISE_PLAN,
  SAVE_BRIEF,
  SAVE_PLAN,
  SAVE_WEEK_SEEDS,
} from './plans';
import {
  CHECK_MEDIA_JOB,
  CREATE_POST,
  EDIT_POST,
  GENERATE_CAROUSEL,
  GENERATE_IMAGE,
  GENERATE_VIDEO,
  GENERATE_MEDIA,
  GET_CALENDAR,
  GET_POST,
  IMPORT_MEDIA_URL,
  LIST_MEDIA,
  LIST_POSTS,
  MAKE_VIDEO,
  REFINE_IMAGE,
  REGENERATE_POST_MEDIA,
  REGENERATE_SLIDE,
  RENDER_POST,
  REORDER_SLIDES,
  RESCHEDULE_POST,
} from './posts';
import {
  GET_ADS,
  GET_ANALYTICS,
  GET_DASHBOARD,
  GET_GEO,
  GET_GTM,
  GET_KEYWORDS,
  GET_PLAN,
  GET_SEO,
  GET_STUDIO,
  GET_VOICE,
  GET_WEEKLY_PLAN,
  LIST_ARTICLES
} from './reads';
import { DIAGNOSE_BRAND, GET_GOALS } from './brand-state';
import {
  ADD_BLOG_TERM,
  GET_BLOG_SETTINGS,
  REMOVE_BLOG_TERM,
  SET_BLOG_SETTINGS
} from './blog-settings';
import { GET_BRAND_SETTINGS, SET_BRAND_SETTINGS } from './brand-settings';
import { DIAGNOSE_RADAR, GET_MARKET_FIELD, LIST_IDEAS } from './market';
import { GET_MEDIA_MODELS, SET_MEDIA_MODEL } from './media-models';
import { GET_MEMORY, RECORD_MEMORY_USED, SAVE_MEMORY } from './memory';
import { GET_KNOWLEDGE_STATUS, SEARCH_KNOWLEDGE } from './knowledge';
import {
  ADD_RADAR_SOURCE,
  GET_RADAR,
  REMOVE_RADAR_SOURCE,
  SET_RADAR_PLATFORM
} from './radar';
import { GEO_ACTION, REFRESH_KEYWORDS, SEO_ACTION } from './search';
import { LIST_SOCIAL_ACCOUNTS, SOCIAL_CONNECT_LINK } from './social';
import { GET_BACKLINKS, GET_GSC, GET_RANKS } from './web-metrics';
import { GET_WRITING_SKILLS } from './writing-skills';
import {
  CREATE_SHARE,
  LIST_SHARES,
  REVOKE_SHARE,
  SHARED_VIEW_TYPES,
} from './shares';
import {
  ADD_COMPETITOR,
  ADD_NOTE,
  ADD_PERSON,
  CREATE_PRODUCT,
  DELETE_COMPETITOR,
  DELETE_DOCUMENT,
  DELETE_PERSON,
  DELETE_PRODUCT,
  GET_BIO,
  RESEARCH_COMPETITORS,
  SET_BIO,
  SET_COLORS,
  SYNC_HISTORY,
  UPDATE_BRAND_KIT,
  UPDATE_COMPETITOR,
  UPDATE_PERSON,
  UPDATE_PRODUCT,
  UPDATE_VOICE
} from './studio';

export type EndpointFailure = { readonly error: string; readonly status: number };

export const BRAND_RESOURCES = {
  post: 'Post',
  article: 'Article',
  product: 'Product',
  person: 'Person',
  competitor: 'Competitor',
  document: 'Document'
} as const;

export type BrandResource = keyof typeof BRAND_RESOURCES;

export const RESOURCE_SEGMENT = ':id';

type EndpointShape = {
  readonly tool: string;
  readonly title: string;
  readonly description: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly input: z.ZodObject<z.ZodRawShape>;
  readonly output: z.ZodType;
  readonly failures: readonly EndpointFailure[];
  readonly destructive: boolean;
  readonly openWorld?: boolean;
};

export type ResourcelessEndpoint = EndpointShape & {
  readonly pathUnderBrand: string;
  /**
   * The same tool, reachable without naming a brand. Declaring it is what makes `slug` optional
   * and what tells the caller a second route exists — an endpoint that omits this one has no way
   * of running outside a brand, and asking for one is an error rather than a silent fallback.
   */
  readonly pathWithoutBrand?: string;
  readonly resource?: undefined;
};

export type ResourceEndpoint = EndpointShape & {
  readonly pathUnderBrand: `${string}/${typeof RESOURCE_SEGMENT}${string}`;
  readonly pathWithoutBrand?: undefined;
  readonly resource: BrandResource;
};

export type BrandEndpoint = ResourcelessEndpoint | ResourceEndpoint;

export const BRAND_ENDPOINTS: readonly BrandEndpoint[] = [
  ADD_BLOG_TERM,
  ADD_COMPETITOR,
  ADD_NOTE,
  ADD_PERSON,
  ADD_RADAR_SOURCE,
  ADS_ACTION,
  ADS_REMIX,
  APPROVE_PLAN,
  BILLING_PORTAL_LINK,
  CHECKOUT_LINK,
  CHECK_CONTENT,
  CHECK_MEDIA_JOB,
  CREATE_POST,
  CREATE_PRODUCT,
  CREATE_SHARE,
  DELETE_ARTICLE,
  DELETE_COMPETITOR,
  DELETE_DOCUMENT,
  DELETE_PERSON,
  DELETE_PRODUCT,
  DIAGNOSE_BRAND,
  DIAGNOSE_RADAR,
  DISCARD_PLAN,
  EDIT_POST,
  GENERATE_ARTICLE,
  GENERATE_CAPTIONS,
  GENERATE_CAROUSEL,
  GENERATE_IMAGE,
  GENERATE_VIDEO,
  GENERATE_MEDIA,
  GEO_ACTION,
  GET_ADS,
  GET_ANALYTICS,
  GET_APPEARANCE,
  GET_ARTICLE,
  GET_AUDIT_FINDINGS,
  GET_AUTOMATIONS,
  GET_BACKLINKS,
  GET_BIO,
  GET_BLOG_SETTINGS,
  GET_BRAND_SETTINGS,
  GET_CALENDAR,
  GET_CREATION_KIT,
  GET_DASHBOARD,
  GET_GEO,
  GET_GOALS,
  GET_GSC,
  GET_GTM,
  GET_KEYWORDS,
  GET_KNOWLEDGE_STATUS,
  GET_MARKET_FIELD,
  GET_MEDIA_MODELS,
  GET_MEMORY,
  GET_PLAN,
  GET_POST,
  GET_RADAR,
  GET_RANKS,
  GET_SEO,
  GET_STUDIO,
  GET_VOICE,
  GET_WEEKLY_PLAN,
  GET_WRITING_SKILLS,
  IMPORT_MEDIA_URL,
  LIST_ARTICLES,
  LIST_AUDIT_CITATIONS,
  LIST_IDEAS,
  LIST_MEDIA,
  LIST_POSTS,
  LIST_SHARES,
  LIST_SOCIAL_ACCOUNTS,
  LIST_WEB_AUDITS,
  LIST_WEB_FIXES,
  MAKE_VIDEO,
  OPTIMIZE_ARTICLE,
  PLAN_WEEK,
  PROPOSE_PLAN,
  PUBLISH_ARTICLE,
  QUERY_DATABASE,
  RECORD_MEMORY_USED,
  REFINE_IMAGE,
  REFRESH_KEYWORDS,
  REGENERATE_POST_MEDIA,
  REGENERATE_SLIDE,
  REMOVE_BLOG_TERM,
  REMOVE_RADAR_SOURCE,
  RENDER_POST,
  REORDER_SLIDES,
  REPLAN_WEEK,
  RESCHEDULE_POST,
  RESEARCH_COMPETITORS,
  REVISE_PLAN,
  REVOKE_SHARE,
  SAVE_BRIEF,
  SAVE_MEMORY,
  SAVE_PLAN,
  SAVE_WEEK_SEEDS,
  SEARCH_KNOWLEDGE,
  SEO_ACTION,
  SET_APPEARANCE,
  SET_AUTOMATION,
  SET_BIO,
  SET_BLOG_SETTINGS,
  SET_BRAND_SETTINGS,
  SET_COLORS,
  SET_MEDIA_MODEL,
  SET_RADAR_PLATFORM,
  SOCIAL_CONNECT_LINK,
  SYNC_HISTORY,
  UNPUBLISH_ARTICLE,
  UPDATE_ARTICLE,
  UPDATE_BRAND_KIT,
  UPDATE_COMPETITOR,
  UPDATE_PERSON,
  UPDATE_PRODUCT,
  UPDATE_VOICE,
];

export function pathFor(endpoint: ResourcelessEndpoint, slug: string): string;
export function pathFor(endpoint: ResourceEndpoint, slug: string, id: string): string;
export function pathFor(endpoint: BrandEndpoint, slug: string, id?: string): string {
  const base = `/api/v1/brands/${encodeURIComponent(slug)}`;
  if (endpoint.resource === undefined) return `${base}${endpoint.pathUnderBrand}`;
  if (!id) throw new Error(`${endpoint.tool} needs a ${endpoint.resource} id`);
  return `${base}${endpoint.pathUnderBrand.replace(RESOURCE_SEGMENT, encodeURIComponent(id))}`;
}

/** Where this tool runs when no brand is named — `null` when it only exists under one. */
export function pathWithoutBrand(endpoint: BrandEndpoint): string | null {
  return endpoint.pathWithoutBrand ? `/api/v1${endpoint.pathWithoutBrand}` : null;
}

// Un id accorciato è una comodità di lettura: la lista dice quale riga, il prefisso basta a
// indicarla. Su una cancellazione non basta — il prefisso ambiguo colpisce la riga sbagliata e
// non si torna indietro — quindi la DELETE prende l'id che il contratto dichiara, per intero.
export function acceptsIdPrefix(endpoint: BrandEndpoint): endpoint is ResourceEndpoint {
  return endpoint.resource !== undefined && endpoint.method !== 'DELETE';
}

export function statusForFailure(endpoint: BrandEndpoint, error: string): number {
  return endpoint.failures.find((f) => f.error === error)?.status ?? 500;
}

export {
  ADS_ACTION,
  ADS_REMIX,
  CHECK_CONTENT,
  CHECK_MEDIA_JOB,
  CREATE_POST,
  GENERATE_CAPTIONS,
  GENERATE_CAROUSEL,
  GENERATE_IMAGE,
  GENERATE_VIDEO,
  EDIT_POST,
  GENERATE_MEDIA,
  GET_ARTICLE,
  GET_AUDIT_FINDINGS,
  GET_CALENDAR,
  GET_CREATION_KIT,
  GET_POST,
  IMPORT_MEDIA_URL,
  LIST_AUDIT_CITATIONS,
  LIST_MEDIA,
  REFINE_IMAGE,
  LIST_POSTS,
  LIST_WEB_AUDITS,
  LIST_WEB_FIXES,
  MAKE_VIDEO,
  REGENERATE_POST_MEDIA,
  REGENERATE_SLIDE,
  RENDER_POST,
  REORDER_SLIDES,
  RESCHEDULE_POST,
  UPDATE_ARTICLE,
};
export { QUERY_DATABASE, QUERY_OPS, QUERY_TABLE_NAMES, QUERY_DEFAULT_ROWS, QUERY_MAX_ROWS } from './query';
export { QUERY_TABLES } from './query-tables';
export {
  DELETE_ARTICLE,
  GENERATE_ARTICLE,
  OPTIMIZE_ARTICLE,
  PUBLISH_ARTICLE,
  UNPUBLISH_ARTICLE
} from './articles';
export type { Article, GetArticleInput, UpdateArticleInput, UpdateArticleResult } from './articles';
export {
  AUDIT_CITATIONS_DEFAULT,
  AUDIT_CITATIONS_MAX,
  WEB_AUDITS_DEFAULT,
  WEB_AUDITS_MAX,
  WEB_FIXES_DEFAULT,
  WEB_FIXES_MAX,
  WEB_FIX_STATUSES,
  WEB_FIX_SURFACES
} from './evidence';
export {
  GET_ADS,
  GET_ANALYTICS,
  GET_DASHBOARD,
  GET_GEO,
  GET_GTM,
  GET_KEYWORDS,
  GET_PLAN,
  GET_SEO,
  GET_STUDIO,
  GET_VOICE,
  GET_WEEKLY_PLAN,
  LIST_ARTICLES
};
export { STUDIO_DOCUMENT_MODES } from './reads';
export type { StudioDocumentMode } from './reads';
export {
  GET_BRAND_SETTINGS,
  SET_BRAND_SETTINGS,
  TARGET_PLATFORMS
} from './brand-settings';
export type { TargetPlatform } from './brand-settings';
export {
  DIAGNOSE_BRAND,
  DOCTOR_GATE_STATUSES,
  DOCTOR_LOOP_STATUSES,
  GET_GOALS,
  GOALS_DEFAULT,
  GOALS_MAX,
  GOAL_CRITERION_STATUSES,
  GOAL_STATUSES
} from './brand-state';
export { DIAGNOSE_RADAR, GET_MARKET_FIELD, IDEA_STATUSES, IDEAS_DEFAULT, IDEAS_MAX, LIST_IDEAS, MARKET_FIELD_DEFAULT, MARKET_FIELD_MAX } from './market';
export {
  GET_MEDIA_MODELS,
  MEDIA_MODEL_JOBS,
  MEDIA_MODEL_SLOT_IDS,
  SET_MEDIA_MODEL
} from './media-models';
export type { MediaModelSlotId } from './media-models';
export {
  ADD_RADAR_SOURCE,
  GET_RADAR,
  RADAR_BASE_SOURCE_KINDS,
  RADAR_PLATFORMS,
  RADAR_PRO_SOURCE_KINDS,
  RADAR_SOURCE_KINDS,
  REMOVE_RADAR_SOURCE,
  SET_RADAR_PLATFORM
} from './radar';
export type { RadarPlatform, RadarSourceKindName } from './radar';
export {
  GET_KNOWLEDGE_STATUS,
  KNOWLEDGE_COLLECTIONS,
  KNOWLEDGE_DOC_STATUSES,
  KNOWLEDGE_FAILURES_MAX,
  KNOWLEDGE_EXCERPT_CHARS,
  KNOWLEDGE_HITS_DEFAULT,
  KNOWLEDGE_HITS_MAX,
  SEARCH_KNOWLEDGE
} from './knowledge';
export type { KnowledgeCollection } from './knowledge';
export {
  AGENT_MEMORY_CATEGORIES,
  GET_MEMORY,
  MEMORY_CATEGORIES,
  MEMORY_ENTRIES_DEFAULT,
  MEMORY_ENTRIES_MAX,
  MEMORY_USED_MAX,
  RECORD_MEMORY_USED,
  SAVE_MEMORY
} from './memory';
export type { AgentMemoryCategory } from './memory';
export { GEO_ACTION, REFRESH_KEYWORDS, SEO_ACTION } from './search';
export { GET_BACKLINKS, GET_GSC, GET_RANKS } from './web-metrics';
export {
  GET_WRITING_SKILLS,
  WRITING_DECK_AGENTS,
  WRITING_SKILL_SOURCES
} from './writing-skills';
export type { WritingDeckAgent } from './writing-skills';
export {
  ADD_COMPETITOR,
  ADD_NOTE,
  ADD_PERSON,
  CONSENT_NOT_ATTESTED,
  CREATE_PRODUCT,
  DELETE_COMPETITOR,
  DELETE_DOCUMENT,
  DELETE_PERSON,
  DELETE_PRODUCT,
  GET_BIO,
  RESEARCH_COMPETITORS,
  SET_BIO,
  SET_COLORS,
  SYNC_HISTORY,
  UPDATE_BRAND_KIT,
  UPDATE_COMPETITOR,
  UPDATE_PERSON,
  UPDATE_PRODUCT,
  UPDATE_VOICE
} from './studio';
export {
  CREATE_SHARE,
  LIST_SHARES,
  REVOKE_SHARE,
  SHARED_VIEW_TYPES,
};
export {
  AUTOMATION_CADENCES,
  AUTOMATION_JOBS,
  AUTOMATION_STATES,
  GET_AUTOMATIONS,
  SET_AUTOMATION
} from './automations';
export type { AutomationJob } from './automations';
export { LIST_SOCIAL_ACCOUNTS, SOCIAL_CONNECT_LINK } from './social';
export {
  ADD_BLOG_TERM,
  BLOG_ANALYTICS_ID_PATTERNS,
  BLOG_ANALYTICS_PROVIDERS,
  BLOG_FONTS,
  BLOG_LAYOUTS,
  BLOG_TERM_KINDS,
  blogAnalyticsIdOk,
  GET_BLOG_SETTINGS,
  REMOVE_BLOG_TERM,
  SET_BLOG_SETTINGS
} from './blog-settings';
export type { BlogAnalyticsProvider, BlogTermKind } from './blog-settings';
export { GET_APPEARANCE, SET_APPEARANCE } from './appearance';
export { BILLING_PORTAL_LINK, CHECKOUT_LINK };
export type { BillingPortalLinkResult, CheckoutLinkInput, CheckoutLinkResult } from './billing';
export type { CheckContentInput, CheckContentResult } from './content';
export type {
  AuditCitationRow,
  WebAuditFindings,
  WebAuditIndexRow,
  WebFixRow
} from './evidence';
export { KIT_FORMATS } from './creation-kit';
export type { GetCreationKitInput, GetCreationKitResult } from './creation-kit';
export type { CreatePostInput, CreatePostResult } from './posts';
export { MAX_MEDIA_ALTERNATIVES } from './posts';
export {
  APPROVE_PLAN,
  DISCARD_PLAN,
  PLAN_CADENCES,
  PLAN_CYCLE_WEEKS,
  PLAN_WEEK,
  PROPOSE_PLAN,
  REPLAN_WEEK,
  REVISE_PLAN,
  SAVE_BRIEF,
  SAVE_PLAN,
  SAVE_WEEK_SEEDS
};
export type { SavePlanInput, SavePlanResult, SaveWeekSeedsInput, SaveWeekSeedsResult } from './plans';
export type { CreateProductInput, CreateProductResult } from './studio';
export type { CreateShareInput, CreateShareResult, SharedViewType } from './shares';
