import type { z } from 'zod';
import { CHECK_CONTENT } from './content';
import { GET_AUDIT_FINDINGS, LIST_AUDIT_CITATIONS, LIST_WEB_AUDITS, LIST_WEB_FIXES } from './evidence';
import { PLAN_CADENCES, PLAN_CYCLE_WEEKS, SAVE_PLAN, SAVE_WEEK_SEEDS } from './plans';
import { CREATE_POST, GET_CALENDAR, LIST_MEDIA, LIST_POSTS } from './posts';

export type EndpointFailure = { readonly error: string; readonly status: number };

export type BrandEndpoint = {
  readonly tool: string;
  readonly title: string;
  readonly description: string;
  readonly method: 'GET' | 'POST';
  readonly pathUnderBrand: string;
  readonly input: z.ZodObject<z.ZodRawShape>;
  readonly output: z.ZodType;
  readonly failures: readonly EndpointFailure[];
  readonly destructive: boolean;
};

export const BRAND_ENDPOINTS: readonly BrandEndpoint[] = [CREATE_POST, LIST_POSTS, GET_CALENDAR, LIST_MEDIA, CHECK_CONTENT, SAVE_PLAN, SAVE_WEEK_SEEDS, LIST_WEB_AUDITS, GET_AUDIT_FINDINGS, LIST_AUDIT_CITATIONS, LIST_WEB_FIXES];

export function pathFor(endpoint: BrandEndpoint, slug: string): string {
  return `/api/v1/brands/${encodeURIComponent(slug)}${endpoint.pathUnderBrand}`;
}

export function statusForFailure(endpoint: BrandEndpoint, error: string): number {
  return endpoint.failures.find((f) => f.error === error)?.status ?? 500;
}

export { CHECK_CONTENT, CREATE_POST, GET_AUDIT_FINDINGS, GET_CALENDAR, LIST_AUDIT_CITATIONS, LIST_MEDIA, LIST_POSTS, LIST_WEB_AUDITS, LIST_WEB_FIXES };
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
export type { CheckContentInput, CheckContentResult } from './content';
export type {
  AuditCitationRow,
  WebAuditFindings,
  WebAuditIndexRow,
  WebFixRow
} from './evidence';
export type { CreatePostInput, CreatePostResult } from './posts';
export { PLAN_CADENCES, PLAN_CYCLE_WEEKS, SAVE_PLAN, SAVE_WEEK_SEEDS };
export type { SavePlanInput, SavePlanResult, SaveWeekSeedsInput, SaveWeekSeedsResult } from './plans';
