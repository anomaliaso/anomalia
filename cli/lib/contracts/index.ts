import type { z } from 'zod';
import { CHECK_CONTENT } from './content';
import { GET_EVIDENCE_RUN, LIST_EVIDENCE_ARTIFACTS, LIST_EVIDENCE_RUNS } from './evidence';
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

export const BRAND_ENDPOINTS: readonly BrandEndpoint[] = [CREATE_POST, LIST_POSTS, GET_CALENDAR, LIST_MEDIA, CHECK_CONTENT, SAVE_PLAN, SAVE_WEEK_SEEDS, LIST_EVIDENCE_RUNS, GET_EVIDENCE_RUN, LIST_EVIDENCE_ARTIFACTS];

export function pathFor(endpoint: BrandEndpoint, slug: string): string {
  return `/api/v1/brands/${encodeURIComponent(slug)}${endpoint.pathUnderBrand}`;
}

export function statusForFailure(endpoint: BrandEndpoint, error: string): number {
  return endpoint.failures.find((f) => f.error === error)?.status ?? 500;
}

export { CHECK_CONTENT, CREATE_POST, GET_CALENDAR, GET_EVIDENCE_RUN, LIST_EVIDENCE_ARTIFACTS, LIST_EVIDENCE_RUNS, LIST_MEDIA, LIST_POSTS };
export {
  EVIDENCE_ARTIFACTS_DEFAULT,
  EVIDENCE_ARTIFACTS_MAX,
  EVIDENCE_ARTIFACT_STATUSES,
  EVIDENCE_ARTIFACT_SURFACES,
  EVIDENCE_CITATIONS_DEFAULT,
  EVIDENCE_CITATIONS_MAX,
  EVIDENCE_RUNS_DEFAULT,
  EVIDENCE_RUNS_MAX
} from './evidence';
export type { CheckContentInput, CheckContentResult } from './content';
export type {
  EvidenceArtifactRow,
  EvidenceCitationRow,
  EvidenceRunDetail,
  EvidenceRunIndexRow
} from './evidence';
export type { CreatePostInput, CreatePostResult } from './posts';
export { PLAN_CADENCES, PLAN_CYCLE_WEEKS, SAVE_PLAN, SAVE_WEEK_SEEDS };
export type { SavePlanInput, SavePlanResult, SaveWeekSeedsInput, SaveWeekSeedsResult } from './plans';
