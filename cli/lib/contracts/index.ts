import type { z } from 'zod';
import { CREATE_POST, GET_CALENDAR, IMPORT_MEDIA_URL, LIST_MEDIA, LIST_POSTS } from './posts';

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

export const BRAND_ENDPOINTS: readonly BrandEndpoint[] = [
  CREATE_POST,
  LIST_POSTS,
  GET_CALENDAR,
  LIST_MEDIA,
  IMPORT_MEDIA_URL
];

export function pathFor(endpoint: BrandEndpoint, slug: string): string {
  return `/api/v1/brands/${encodeURIComponent(slug)}${endpoint.pathUnderBrand}`;
}

export function statusForFailure(endpoint: BrandEndpoint, error: string): number {
  return endpoint.failures.find((f) => f.error === error)?.status ?? 500;
}

export { CREATE_POST, GET_CALENDAR, IMPORT_MEDIA_URL, LIST_MEDIA, LIST_POSTS };
export type { CreatePostInput, CreatePostResult } from './posts';
