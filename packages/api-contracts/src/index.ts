import type { z } from 'zod';
import { inAFamily } from './families';
import { ADS_ACTION, ADS_REMIX } from './ads';
import { SET_APPEARANCE } from './appearance';
import { SET_AUTOMATION } from './automations';
import { BILLING_PORTAL_LINK, CHECKOUT_LINK } from './billing';
import { GENERATE_CAPTIONS } from './captions';
import {
  DELETE_ARTICLE,
  GENERATE_ARTICLE,
  OPTIMIZE_ARTICLE,
  PUBLISH_ARTICLE,
  UNPUBLISH_ARTICLE,
  UPDATE_ARTICLE
} from './articles';
import { CHECK_CONTENT } from './content';
import { QUERY_DATABASE } from './query';
import { INSERT_ROW, UPDATE_ROW } from './write';
import { GET_CREATION_KIT } from './creation-kit';
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
  CREATE_POST,
  EDIT_POST,
  GENERATE_CAROUSEL,
  GENERATE_IMAGE,
  GENERATE_VIDEO,
  GENERATE_MEDIA,
  IMPORT_MEDIA_URL,
  MAKE_VIDEO,
  REFINE_MEDIA,
  REGENERATE_POST_MEDIA,
  REGENERATE_SLIDE,
  RENDER_POST,
  REORDER_SLIDES,
  RESCHEDULE_POST,
} from './posts';
import { GET_ADS } from './reads';
import { DIAGNOSE_BRAND } from './brand-state';
import {
  ADD_BLOG_TERM,
  REMOVE_BLOG_TERM,
  SET_BLOG_SETTINGS
} from './blog-settings';
import { SET_BRAND_SETTINGS } from './brand-settings';
import { DIAGNOSE_RADAR } from './market';
import { GET_MEDIA_MODELS, SET_MEDIA_MODEL } from './media-models';
import { RECORD_MEMORY_USED, SAVE_MEMORY } from './memory';
import { SEARCH_KNOWLEDGE } from './knowledge';
import {
  ADD_RADAR_SOURCE,
  REMOVE_RADAR_SOURCE,
  SET_RADAR_PLATFORM
} from './radar';
import { GEO_ACTION, REFRESH_KEYWORDS, SEO_ACTION } from './search';
import { SOCIAL_CONNECT_LINK } from './social';
import { GET_GSC } from './web-metrics';
import { GET_WRITING_SKILLS } from './writing-skills';
import {
  CREATE_SHARE,
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

/**
 * L'intestazione con cui un client dice QUALE tool sta chiamando. `ai_calls` registra la chiamata
 * al modello, non chi l'ha causata, e le sue etichette (`planStrategy`, `seoAgent`) sono condivise
 * fra l'autopilot, la chat in-app e gli agenti esterni: senza questo nome la spesa di un tool non
 * è separabile da quella di nessun altro, e «questo tool vale quello che costa» resta senza
 * risposta.
 */
export const TOOL_HEADER = 'x-anomalia-tool';

/**
 * Il nome arriva dalla rete, quindi non è un nome finché non lo si guarda: si accetta solo la
 * forma che un tool ha davvero (tutti e ottanta) e si scarta il resto invece di scriverlo.
 */
export function toolFromHeader(value: string | null | undefined): string | null {
  return value && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : null;
}

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
  CREATE_POST,
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
  GEO_ACTION,
  GET_ADS,
  GET_CREATION_KIT,
  GET_GSC,
  GET_MEDIA_MODELS,
  GET_WRITING_SKILLS,
  IMPORT_MEDIA_URL,
  INSERT_ROW,
  MAKE_VIDEO,
  OPTIMIZE_ARTICLE,
  PLAN_WEEK,
  PROPOSE_PLAN,
  PUBLISH_ARTICLE,
  QUERY_DATABASE,
  RECORD_MEMORY_USED,
  REFINE_MEDIA,
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
  UPDATE_ROW,
  UPDATE_VOICE,
];

export {
  BRAND_FAMILIES,
  familyCalls,
  familyInput,
  inAFamily,
  UPDATE_BRAND_IDENTITY
} from './families';
export type { BrandFamily } from './families';

/**
 * Gli endpoint che diventano un tool per conto proprio: il registro meno chi e' finito in una
 * famiglia. Sta scritto qui una volta perche' lo leggono il registrar e ogni test che confronta
 * `tools/list` col registro — e una sottrazione ripetuta in cinque posti diverge al primo che
 * qualcuno dimentica.
 */
export const OWN_TOOL_ENDPOINTS: readonly BrandEndpoint[] = BRAND_ENDPOINTS.filter(
  (endpoint) => !inAFamily(endpoint)
);

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

export function statusForFailure(
  endpoint: { readonly failures: readonly EndpointFailure[] },
  error: string
): number {
  return endpoint.failures.find((f) => f.error === error)?.status ?? 500;
}

export {
  ADS_ACTION,
  ADS_REMIX,
  CHECK_CONTENT,
  CREATE_POST,
  GENERATE_CAPTIONS,
  GENERATE_CAROUSEL,
  GENERATE_IMAGE,
  GENERATE_VIDEO,
  EDIT_POST,
  GENERATE_MEDIA,
  GET_CREATION_KIT,
  IMPORT_MEDIA_URL,
  REFINE_MEDIA,
  MAKE_VIDEO,
  REGENERATE_POST_MEDIA,
  REGENERATE_SLIDE,
  RENDER_POST,
  REORDER_SLIDES,
  RESCHEDULE_POST,
  UPDATE_ARTICLE,
};
/**
 * Gli schemi delle letture ritirate da MCP. La rotta REST resta e continua a validare con questi;
 * nessuno di essi e' un endpoint del registry, quindi nessuno diventa un tool.
 */
export { CHECK_MEDIA_JOB_READ, LIST_MEDIA_READ } from './posts';
export { GET_ARTICLE_READ } from './articles';
export {
  GET_AUDIT_FINDINGS_READ,
  LIST_AUDIT_CITATIONS_READ,
  LIST_WEB_AUDITS_READ,
  LIST_WEB_FIXES_READ
} from './evidence';
export { LIST_SHARES_READ } from './shares';
export { LIST_SOCIAL_ACCOUNTS_READ } from './social';

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
export { GET_ADS };
export { STUDIO_DOCUMENT_MODES } from './reads';
export type { StudioDocumentMode } from './reads';
export {
  SET_BRAND_SETTINGS,
  TARGET_PLATFORMS
} from './brand-settings';
export type { TargetPlatform } from './brand-settings';
export {
  DIAGNOSE_BRAND,
  DOCTOR_GATE_STATUSES,
  DOCTOR_LOOP_STATUSES,
  GOALS_DEFAULT,
  GOALS_MAX,
  GOAL_CRITERION_STATUSES,
  GOAL_STATUSES
} from './brand-state';
export { DIAGNOSE_RADAR, MARKET_FIELD_DEFAULT, MARKET_FIELD_MAX } from './market';
export {
  GET_MEDIA_MODELS,
  MEDIA_MODEL_JOBS,
  MEDIA_MODEL_SLOT_IDS,
  SET_MEDIA_MODEL
} from './media-models';
export type { MediaModelSlotId } from './media-models';
export {
  ADD_RADAR_SOURCE,
  RADAR_BASE_SOURCE_KINDS,
  RADAR_PLATFORMS,
  RADAR_PRO_SOURCE_KINDS,
  RADAR_SOURCE_KINDS,
  REMOVE_RADAR_SOURCE,
  SET_RADAR_PLATFORM
} from './radar';
export type { RadarPlatform, RadarSourceKindName } from './radar';
export {
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
  MEMORY_CATEGORIES,
  MEMORY_ENTRIES_DEFAULT,
  MEMORY_ENTRIES_MAX,
  MEMORY_USED_MAX,
  RECORD_MEMORY_USED,
  SAVE_MEMORY,
  UPDATE_MEMORY_ENTRY
} from './memory';
export type { AgentMemoryCategory } from './memory';
export { GEO_ACTION, REFRESH_KEYWORDS, SEO_ACTION } from './search';
export { GET_GSC } from './web-metrics';
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
  REVOKE_SHARE,
  SHARED_VIEW_TYPES,
};
export {
  AUTOMATION_CADENCES,
  AUTOMATION_JOBS,
  AUTOMATION_STATES,
  SET_AUTOMATION
} from './automations';
export type { AutomationJob } from './automations';
export { SOCIAL_CONNECT_LINK } from './social';
export {
  ADD_BLOG_TERM,
  BLOG_ANALYTICS_ID_PATTERNS,
  BLOG_ANALYTICS_PROVIDERS,
  BLOG_FONTS,
  BLOG_LAYOUTS,
  BLOG_TERM_KINDS,
  blogAnalyticsIdOk,
  REMOVE_BLOG_TERM,
  SET_BLOG_SETTINGS
} from './blog-settings';
export type { BlogAnalyticsProvider, BlogTermKind } from './blog-settings';
export { SET_APPEARANCE } from './appearance';
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
export { INSERT_ROW, UPDATE_ROW, UPDATE_MAX_ROWS } from './write';
export { TABLE_CHECKS, WRITABLE_COLUMNS } from './write-rules';
