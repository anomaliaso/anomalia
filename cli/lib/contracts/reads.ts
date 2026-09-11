import { z } from 'zod';
import type { BrandEndpoint } from './index';

const NoInput = z.object({}).strict();

const JsonObject = z.record(z.string(), z.unknown());

export const STUDIO_DOCUMENT_MODES = ['index', 'full'] as const;

export type StudioDocumentMode = (typeof STUDIO_DOCUMENT_MODES)[number];

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

export const GET_ADS = {
  tool: 'get_ads',
  title: 'Ads overview',
  description:
    'The brand\'s paid campaigns: what is running, what has been proposed and is waiting, and ' +
    'which advertising accounts are connected. ads_action is what changes any of it. Free.',
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

// La dashboard è il brand stesso: `GET /api/v1/brands/:slug`, nessun segmento sotto. Con
// `pathUnderBrand` vuoto `pathFor` produce già quell'URL — non serve un secondo registro per gli
// endpoint fuori dal brand, ne resta fuori uno solo (`list_brands`, che di brand non ne ha uno).

