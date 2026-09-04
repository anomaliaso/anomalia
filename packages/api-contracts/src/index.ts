import type { z } from 'zod';
import { ADS_REMIX } from './ads';
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
  PLAN_CADENCES,
  PLAN_CYCLE_WEEKS,
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
  GET_GEO,
  GET_KEYWORDS,
  GET_PLAN,
  GET_SEO,
  GET_STUDIO,
  GET_WEEKLY_PLAN,
  LIST_ARTICLES
} from './reads';
import {
  CREATE_SHARE,
  LIST_SHARES,
  REVOKE_SHARE,
  SHARED_VIEW_TYPES,
} from './shares';
import {
  CREATE_PRODUCT,
  DELETE_PRODUCT,
  GET_BIO,
  SET_BIO,
  UPDATE_COMPETITOR,
  UPDATE_PERSON,
  UPDATE_PRODUCT
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
  ADS_REMIX,
  CHECK_CONTENT,
  CREATE_POST,
  CREATE_PRODUCT,
  CREATE_SHARE,
  DELETE_PRODUCT,
  GET_ADS,
  GET_ARTICLE,
  GET_AUDIT_FINDINGS,
  GET_BIO,
  GET_CALENDAR,
  GET_CREATION_KIT,
  GET_GEO,
  GET_KEYWORDS,
  GET_PLAN,
  GET_POST,
  GET_SEO,
  GET_STUDIO,
  GET_WEEKLY_PLAN,
  IMPORT_MEDIA_URL,
  LIST_ARTICLES,
  LIST_AUDIT_CITATIONS,
  LIST_MEDIA,
  LIST_POSTS,
  LIST_SHARES,
  LIST_WEB_AUDITS,
  LIST_WEB_FIXES,
  RENDER_POST,
  RESCHEDULE_POST,
  REVOKE_SHARE,
  SAVE_PLAN,
  SAVE_WEEK_SEEDS,
  SET_BIO,
  UPDATE_ARTICLE,
  UPDATE_COMPETITOR,
  UPDATE_PERSON,
  UPDATE_PRODUCT,
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
  GET_GEO,
  GET_KEYWORDS,
  GET_PLAN,
  GET_SEO,
  GET_STUDIO,
  GET_WEEKLY_PLAN,
  LIST_ARTICLES
};
export {
  CREATE_PRODUCT,
  DELETE_PRODUCT,
  GET_BIO,
  SET_BIO,
  UPDATE_COMPETITOR,
  UPDATE_PERSON,
  UPDATE_PRODUCT
} from './studio';
export {
  CREATE_SHARE,
  LIST_SHARES,
  REVOKE_SHARE,
  SHARED_VIEW_TYPES,
};
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
export { PLAN_CADENCES, PLAN_CYCLE_WEEKS, SAVE_PLAN, SAVE_WEEK_SEEDS };
export type { SavePlanInput, SavePlanResult, SaveWeekSeedsInput, SaveWeekSeedsResult } from './plans';
export type { CreateProductInput, CreateProductResult } from './studio';
export type { CreateShareInput, CreateShareResult, SharedViewType } from './shares';
