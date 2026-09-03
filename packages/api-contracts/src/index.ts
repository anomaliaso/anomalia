import type { z } from 'zod';
import { CREATE_POST, GET_CALENDAR, LIST_POSTS } from './posts';

/**
 * Un endpoint di brand dichiarato una volta sola: la route valida e sceglie lo status con questo,
 * il client HTTP ci costruisce la chiamata, l'MCP ci registra il tool. La stessa forma stava in
 * tre posti e andava in deriva in silenzio — `PostPatch` della CLI aveva già perso un campo che
 * il server accetta.
 *
 * Descrive il WIRE, non il dominio: `platforms` è un array di stringhe, non l'elenco delle
 * piattaforme, perché a decidere quali esistono resta il servizio.
 */
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

export const BRAND_ENDPOINTS: readonly BrandEndpoint[] = [CREATE_POST, LIST_POSTS, GET_CALENDAR];

export function pathFor(endpoint: BrandEndpoint, slug: string): string {
  return `/api/v1/brands/${encodeURIComponent(slug)}${endpoint.pathUnderBrand}`;
}

/** Un errore che l'endpoint non ha dichiarato è un guasto nostro, non una richiesta sbagliata. */
export function statusForFailure(endpoint: BrandEndpoint, error: string): number {
  return endpoint.failures.find((f) => f.error === error)?.status ?? 500;
}

export { CREATE_POST, GET_CALENDAR, LIST_POSTS };
export type { CreatePostInput, CreatePostResult } from './posts';
