import type { z } from 'zod';
import { ADS_REMIX } from './ads';
import { GET_AUTOMATIONS, SET_AUTOMATION } from './automations';
import { BILLING_PORTAL_LINK, CHECKOUT_LINK } from './billing';
import { GET_ARTICLE, UPDATE_ARTICLE } from './articles';
import { CHECK_CONTENT } from './content';
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
  PROPOSE_PLAN,
  REVISE_PLAN,
  SAVE_PLAN,
  SAVE_WEEK_SEEDS,
} from './plans';
import {
  CREATE_POST,
  GET_CALENDAR,
  GET_POST,
  IMPORT_MEDIA_URL,
  LIST_MEDIA,
  LIST_POSTS,
  RENDER_POST,
  RESCHEDULE_POST,
} from './posts';
import {
  GET_ADS,
  GET_ANALYTICS,
  GET_GEO,
  GET_GTM,
  GET_KEYWORDS,
  GET_PLAN,
  GET_SEO,
  GET_STUDIO,
  GET_VOICE,
  GET_WEEKLY_PLAN,
  LIST_ARTICLES,
  LIST_PRODUCTS
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
  CREATE_PRODUCT,
  DELETE_PRODUCT,
  GET_BIO,
  RESEARCH_COMPETITORS,
  SET_BIO,
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
  competitor: 'Competitor'
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
  readonly resource?: undefined;
};

export type ResourceEndpoint = EndpointShape & {
  readonly pathUnderBrand: `${string}/${typeof RESOURCE_SEGMENT}${string}`;
  readonly resource: BrandResource;
};

export type BrandEndpoint = ResourcelessEndpoint | ResourceEndpoint;

export const BRAND_ENDPOINTS: readonly BrandEndpoint[] = [
  ADD_BLOG_TERM,
  ADD_COMPETITOR,
  ADD_RADAR_SOURCE,
  ADS_REMIX,
  APPROVE_PLAN,
  BILLING_PORTAL_LINK,
  CHECKOUT_LINK,
  CHECK_CONTENT,
  CREATE_POST,
  CREATE_PRODUCT,
  CREATE_SHARE,
  DELETE_PRODUCT,
  DIAGNOSE_BRAND,
  DIAGNOSE_RADAR,
  DISCARD_PLAN,
  GEO_ACTION,
  GET_ADS,
  GET_ANALYTICS,
  GET_ARTICLE,
  GET_AUDIT_FINDINGS,
  GET_AUTOMATIONS,
  GET_BACKLINKS,
  GET_BIO,
  GET_BLOG_SETTINGS,
  GET_BRAND_SETTINGS,
  GET_CALENDAR,
  GET_CREATION_KIT,
  GET_GEO,
  GET_GOALS,
  GET_GSC,
  GET_GTM,
  GET_KEYWORDS,
  GET_KNOWLEDGE_STATUS,
  GET_MARKET_FIELD,
  GET_MEDIA_MODELS,
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
  LIST_PRODUCTS,
  LIST_SHARES,
  LIST_SOCIAL_ACCOUNTS,
  LIST_WEB_AUDITS,
  LIST_WEB_FIXES,
  PROPOSE_PLAN,
  REFRESH_KEYWORDS,
  REMOVE_BLOG_TERM,
  REMOVE_RADAR_SOURCE,
  RENDER_POST,
  RESCHEDULE_POST,
  RESEARCH_COMPETITORS,
  REVISE_PLAN,
  REVOKE_SHARE,
  SAVE_PLAN,
  SAVE_WEEK_SEEDS,
  SEARCH_KNOWLEDGE,
  SEO_ACTION,
  SET_AUTOMATION,
  SET_BIO,
  SET_BLOG_SETTINGS,
  SET_BRAND_SETTINGS,
  SET_MEDIA_MODEL,
  SET_RADAR_PLATFORM,
  SOCIAL_CONNECT_LINK,
  SYNC_HISTORY,
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

export function statusForFailure(endpoint: BrandEndpoint, error: string): number {
  return endpoint.failures.find((f) => f.error === error)?.status ?? 500;
}

export {
  ADS_REMIX,
  CHECK_CONTENT,
  CREATE_POST,
  GET_ARTICLE,
  GET_AUDIT_FINDINGS,
  GET_CALENDAR,
  GET_CREATION_KIT,
  GET_POST,
  IMPORT_MEDIA_URL,
  LIST_AUDIT_CITATIONS,
  LIST_MEDIA,
  LIST_POSTS,
  LIST_WEB_AUDITS,
  LIST_WEB_FIXES,
  RENDER_POST,
  RESCHEDULE_POST,
  UPDATE_ARTICLE,
};
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
  GET_GEO,
  GET_GTM,
  GET_KEYWORDS,
  GET_PLAN,
  GET_SEO,
  GET_STUDIO,
  GET_VOICE,
  GET_WEEKLY_PLAN,
  LIST_ARTICLES,
  LIST_PRODUCTS
};
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
  CREATE_PRODUCT,
  DELETE_PRODUCT,
  GET_BIO,
  RESEARCH_COMPETITORS,
  SET_BIO,
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
  BLOG_FONTS,
  BLOG_LAYOUTS,
  BLOG_TERM_KINDS,
  GET_BLOG_SETTINGS,
  REMOVE_BLOG_TERM,
  SET_BLOG_SETTINGS
} from './blog-settings';
export type { BlogTermKind } from './blog-settings';
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
export {
  APPROVE_PLAN,
  DISCARD_PLAN,
  PLAN_CADENCES,
  PLAN_CYCLE_WEEKS,
  PROPOSE_PLAN,
  REVISE_PLAN,
  SAVE_PLAN,
  SAVE_WEEK_SEEDS
};
export type { SavePlanInput, SavePlanResult, SaveWeekSeedsInput, SaveWeekSeedsResult } from './plans';
export type { CreateProductInput, CreateProductResult } from './studio';
export type { CreateShareInput, CreateShareResult, SharedViewType } from './shares';
