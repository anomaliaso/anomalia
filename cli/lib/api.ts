/**
 * Thin HTTP client for the Anomalia CLI.
 * No Supabase, no DB access, no secrets — just HTTP calls to the Anomalia API.
 */

import { appUrl } from './config.ts';
import { pathFor, type BrandEndpoint } from './contracts/index.ts';

async function request<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  // Resolved per call, not at import time: loadEnv() sets PUBLIC_APP_URL after the module
  // graph is already loaded, so a module-level constant would freeze the production default
  // and ignore the local dev server.
  const url = `${appUrl()}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function get<T>(path: string, token: string): Promise<T> {
  return request<T>(path, token);
}

function post<T>(path: string, token: string, body?: unknown): Promise<T> {
  return request<T>(path, token, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Chiama un endpoint dichiarato nel registry. Una GET porta i campi in query, una POST nel body:
 * chi aggiunge un endpoint non scrive più un metodo qui: lo dichiara una volta e questo lo sa
 * già chiamare.
 */
export function callEndpoint<T>(
  endpoint: BrandEndpoint,
  token: string,
  slug: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const path = pathFor(endpoint, slug);
  if (endpoint.method === 'POST') return post<T>(path, token, input);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  const qs = query.toString();
  return get<T>(qs ? `${path}?${qs}` : path, token);
}

// ── Types ───────────────────────────────────────────────────────────────

export type BrandSummary = {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  status: string | null;
  autopilot_enabled: boolean;
  autopilot_failure_count: number;
  last_autopilot_run_at: string | null;
  timezone: string;
  pendingCount: number;
};

export type BrandDetail = {
  brand: BrandSummary;
  pendingCount: number;
  runs: { status: string; posts_created: number; created_at: string; error: string | null }[];
  plan: { id: string; status: string; cadence: string; weeks: unknown[] } | null;
  productCount: number;
  accountCount: number;
  scheduledCount: number;
  publishedCount: number;
  hasGtm: boolean;
  hasContentPlans: boolean;
  hasHistory: boolean;
  kit: { about: string | null; brand_colors: unknown } | null;
  logoUrl: string | null;
};

export type Post = {
  id: string;
  brand_id: string;
  platform: string | null;
  platforms: string[] | null;
  caption: string | null;
  image_prompt: string | null;
  slot: string | null;
  media_url: string | null;
  status: string;
  content_type: string | null;
  scheduled_for: string | null;
  published_url: string | null;
  product_name: string | null;
  revisions_count: number | null;
  pillar: string | null;
  format: string | null;
  created_at: string;
};

export type EditorialPlanData = {
  plan: Record<string, unknown> | null;
  proposed: Record<string, unknown> | null;
  proposedFeedback: string | null;
  currentWeek: number | null;
  quota: { used: number; remaining: number };
};

export type WeeklyPlanData = {
  plan: {
    cadence: string;
    weeks: { index: number; theme: string; status: string }[];
    platform_mix: unknown;
    strategy: string | null;
  } | null;
  currentWeekIdx: number | null;
  posts: { id: string; platform: string | null; caption: string | null; status: string; slot: string | null; scheduled_for: string | null; pillar: string | null; format: string | null }[];
  seeds: { id: string; seeds: unknown; editorial_week: number | null } | null;
  quota: { used: number; max: number };
};

export type GtmData = {
  gtm: Record<string, unknown> | null;
  proposed: Record<string, unknown> | null;
  proposedFeedback: string | null;
  currentPhase: number | null;
  phaseStatuses: ('done' | 'now' | 'next')[];
  horizons: readonly string[];
  studioPct: number;
};

export type AnalyticsData = {
  total: number;
  scheduled: number;
  pending: number;
  failed: number;
  platforms: [string, number][];
  upcomingPosts: { id: string; platform: string | null; caption: string | null; scheduled_for: string | null }[];
  recentActivity: { id: string; platform: string | null; status: string; caption: string | null; error: string | null; created_at: string }[];
  socialPerformance: { platform: string; posts: number; totals: { views: number; likes: number; comments: number; shares: number } }[];
  topPosts: { id: string; platform: string; caption: string | null; thumbnail_url: string | null; url: string | null; published_at: string | null; metrics: Record<string, number> }[];
  products: number;
  accounts: number;
};

export type StudioData = {
  kit: Record<string, unknown> | null;
  products: { id: string; title: string; pricing: string | null; images: unknown; featured: boolean | null }[];
  documents: { id: string; kind: string; title: string; content_text: string | null }[];
  history: { id: string; platform: string; content: string | null; metrics: Record<string, number> }[];
  people: { id: string; name: string; role: string | null; kind: string; description: string | null; consent: boolean; imageCount: number }[];
  competitors: { id: string; name: string; website: string | null; kind: string; rationale: string | null; source: string }[];
  targetPlatforms: string[];
  platformInstructions: Record<string, string>;
  language: string;
  studioPct: number;
};

export type VoiceData = {
  platforms: string[];
  voiceMode: string;
  voiceFramework: Record<string, unknown>;
  platformRules: Record<string, Record<string, unknown>>;
  avoid: string[];
  platformInstructions: Record<string, string>;
  studioPct: number;
};

export type CalendarData = {
  posts: Record<string, unknown>[];
  year: number;
  month: number;
  monthLabel: string;
  prevYM: string;
  nextYM: string;
  timezone: string;
};

export type SeoData = {
  audit: { tech_score: number | null; tech: Record<string, unknown> | null; search: Record<string, unknown> | null; backlinks: Record<string, unknown> | null; created_at: string } | null;
  plan: { grade: string | null; evaluation: { grade: string; summary: string; strengths: string[]; weaknesses: string[] } | null; initiatives: SeoInitiative[]; created_at: string } | null;
  assets: Record<string, { id: string; kind: string; title: string; format: string | null; target_path: string | null }>;
};

export type SeoInitiative = {
  id: string; type: string; title: string; targetQuery?: string;
  impact?: string; effort?: string; rationale?: string;
};

export type GeoData = {
  audit: { tech_score: number | null; share_of_voice: number | null; citations: GeoCitation[] | null; created_at: string } | null;
  aiOverview: Record<string, unknown> | null;
  trend: { techScore: number | null; shareOfVoice: number | null; at: string }[];
  artifacts: { id: string; kind: string; title: string; format: string | null; target_path: string | null }[];
};

export type GeoCitation = { prompt?: string; surface?: string; cited?: boolean; mentioned?: boolean; competitors?: string[] };

export type KeywordsData = {
  strategy: { focusSummary: string; keywords: KeywordRow[]; competitorGaps: { competitor: string; gap: string }[] } | null;
  citations: { uri: string; title: string }[];
  updatedAt: string | null;
};

export type KeywordRow = {
  keyword: string; intent?: string; volume?: number | null; difficulty?: number | null;
  opportunity?: string; action?: string; rationale?: string;
};

export type WebArticle = {
  id: string; slug: string; title: string;
  meta_title: string | null; meta_description: string | null;
  status: string; scheduled_for: string | null; published_at: string | null;
  source_initiative_id: string | null; created_at: string;
};

/** Every scalar field the post editor can write. `media_url: null` clears the image (text-only). */
export type PostPatch = {
  caption?: string; image_prompt?: string; platforms?: string[]; content_type?: string;
  format?: string; slot?: string; product_name?: string; first_comment?: string;
  title?: string; link_url?: string | null; subreddit?: string;
  media_url?: string | null; platform_captions?: Record<string, string> | null;
};

export type PostState = {
  content_type: string | null; format: string | null;
  platform: string | null; platforms: string[] | null;
  caption: string | null; title: string | null; first_comment: string | null;
  link_url: string | null; subreddit: string | null;
  media_url: string | null; image_prompt?: string | null;
  is_carousel: boolean; slide_count: number;
  slides: { index: number; image_prompt: string | null; has_image: boolean; url: string }[] | null;
  status: string; text_only: boolean;
};

// ── API methods ─────────────────────────────────────────────────────────

export const api = {
  // Brands
  listBrands: (t: string) => get<BrandSummary[]>('/api/v1/brands', t),
  getBrand: (t: string, slug: string) => get<BrandDetail>(`/api/v1/brands/${slug}`, t),

  // Posts
  getPosts: (t: string, slug: string, status?: string) =>
    get<Post[]>(`/api/v1/brands/${slug}/posts${status ? `?status=${status}` : ''}`, t),

  // Editorial plan
  getEditorialPlan: (t: string, slug: string) =>
    get<EditorialPlanData>(`/api/v1/brands/${slug}/editorial-plan`, t),

  // Weekly plan
  getWeeklyPlan: (t: string, slug: string) =>
    get<WeeklyPlanData>(`/api/v1/brands/${slug}/weekly-plan`, t),

  // GTM
  getGtm: (t: string, slug: string) =>
    get<GtmData>(`/api/v1/brands/${slug}/gtm`, t),

  // Analytics
  getAnalytics: (t: string, slug: string) =>
    get<AnalyticsData>(`/api/v1/brands/${slug}/analytics`, t),

  // Studio
  getStudio: (t: string, slug: string) =>
    get<StudioData>(`/api/v1/brands/${slug}/studio`, t),

  // Studio — Brand Kit
  updateBrandKit: (t: string, slug: string, data: { about?: string; category?: string; target_audience?: string; brand_style?: string; language?: string }) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/studio/kit`, t, { method: 'PUT', body: JSON.stringify(data) }),

  updateColors: (t: string, slug: string, colors: string[]) =>
    request<{ ok: boolean; colors: string[] }>(`/api/v1/brands/${slug}/studio/colors`, t, { method: 'PUT', body: JSON.stringify({ colors }) }),

  // Studio — People
  addPerson: (t: string, slug: string, data: { name: string; role?: string; description?: string; kind?: string; gender?: string; ageRange?: string; ethnicity?: string; vibe?: string; consent?: boolean }) =>
    post<{ ok: boolean; person: { id: string; name: string; role: string | null; kind: string } }>(`/api/v1/brands/${slug}/studio/people`, t, data),

  deletePerson: (t: string, slug: string, personId: string) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/studio/people/${personId}`, t, { method: 'DELETE' }),

  // Studio — Documents/Knowledge
  addDocument: (t: string, slug: string, data: { title?: string; content_text: string; kind?: string }) =>
    post<{ ok: boolean; document: { id: string; kind: string; title: string } }>(`/api/v1/brands/${slug}/studio/documents`, t, data),

  deleteDocument: (t: string, slug: string, docId: string) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/studio/documents/${docId}`, t, { method: 'DELETE' }),

  // Studio — Competitors
  addCompetitor: (t: string, slug: string, data: { name: string; website?: string; kind?: string; rationale?: string }) =>
    post<{ ok: boolean; competitor: { id: string; name: string; website: string | null; kind: string; source: string } }>(`/api/v1/brands/${slug}/studio/competitors`, t, data),

  updateCompetitor: (t: string, slug: string, compId: string, data: { name?: string; website?: string; kind?: string; rationale?: string }) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/studio/competitors/${compId}`, t, { method: 'PUT', body: JSON.stringify(data) }),

  deleteCompetitor: (t: string, slug: string, compId: string) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/studio/competitors/${compId}`, t, { method: 'DELETE' }),

  researchCompetitors: (t: string, slug: string) =>
    post<{ ok: boolean; found: number; added: number }>(`/api/v1/brands/${slug}/studio/competitors/research`, t),

  // Studio — History
  syncHistory: (t: string, slug: string) =>
    post<{ synced: number; noAccounts?: boolean; errors?: string[] }>(`/api/v1/brands/${slug}/studio/history/sync`, t),

  // Voice
  getVoice: (t: string, slug: string) =>
    get<VoiceData>(`/api/v1/brands/${slug}/voice`, t),

  // Calendar
  getCalendar: (t: string, slug: string, month?: string) =>
    get<CalendarData>(`/api/v1/brands/${slug}/calendar${month ? `?month=${month}` : ''}`, t),

  // Actions
  approvePost: (t: string, slug: string, postId: string) =>
    post<{ ok?: boolean; error?: string }>(`/api/v1/brands/${slug}/posts/${postId}/approve`, t),

  approveAll: (t: string, slug: string) =>
    post<{ results: { id: string; ok: boolean; error?: string }[] }>(`/api/v1/brands/${slug}/posts/approve-all`, t),

  tick: (t: string, slug: string) =>
    post<Record<string, unknown>>(`/api/v1/brands/${slug}/tick`, t),

  // ── Post editing ──────────────────────────────────────────────────────

  updatePost: (t: string, slug: string, postId: string, data: PostPatch) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/posts/${postId}`, t, { method: 'PUT', body: JSON.stringify(data) }),

  // Post state incl. carousel slides — richer than the row in getPosts.
  getPostMedia: (t: string, slug: string, postId: string) =>
    get<PostState>(`/api/v1/brands/${slug}/posts/${postId}/media`, t),

  postMedia: (t: string, slug: string, postId: string, body: { action: string; instruction?: string; prompt?: string; index?: number; order?: number[]; duration?: number; script?: string; aspectRatio?: string }) =>
    post<{ success?: boolean; error?: string; rendered?: boolean; media_url?: string; slide_index?: number; slide_count?: number; notes?: string; duration_seconds?: number; videos_left?: number }>(`/api/v1/brands/${slug}/posts/${postId}/media`, t, body),

  deletePost: (t: string, slug: string, postId: string) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/posts/${postId}`, t, { method: 'DELETE' }),

  reschedulePost: (t: string, slug: string, postId: string, scheduled_for: string) =>
    post<{ ok: boolean; scheduled_for: string }>(`/api/v1/brands/${slug}/posts/${postId}/reschedule`, t, { scheduled_for }),

  renderPost: (t: string, slug: string, postId: string) =>
    post<{ ok: boolean; url: string | null; error?: string | null }>(`/api/v1/brands/${slug}/posts/${postId}/render`, t),

  publishPost: (t: string, slug: string, postId: string) =>
    post<{ ok: boolean; status: string }>(`/api/v1/brands/${slug}/posts/${postId}/publish`, t),

  // ── Editorial plan editing ────────────────────────────────────────────

  updateEditorialPlan: (t: string, slug: string, data: { voice?: unknown; cadence?: string; platform_mix?: unknown; week_index?: number; week_theme?: string; week_brief?: string }) =>
    post<{ ok: boolean }>(`/api/v1/brands/${slug}/editorial-plan/update`, t, data),

  proposePlan: (t: string, slug: string) =>
    post<{ ok: boolean; plan: unknown }>(`/api/v1/brands/${slug}/editorial-plan/propose`, t),

  revisePlan: (t: string, slug: string, feedback: string) =>
    post<{ ok: boolean; plan: unknown }>(`/api/v1/brands/${slug}/editorial-plan/revise`, t, { feedback }),

  approvePlan: (t: string, slug: string) =>
    post<{ ok: boolean }>(`/api/v1/brands/${slug}/editorial-plan/approve`, t),

  discardPlan: (t: string, slug: string) =>
    post<{ ok: boolean }>(`/api/v1/brands/${slug}/editorial-plan/discard`, t),

  replanWeek: (t: string, slug: string, week_index: number, brief: string) =>
    post<{ ok: boolean }>(`/api/v1/brands/${slug}/editorial-plan/replan-week`, t, { week_index, brief }),

  saveBrief: (t: string, slug: string, week_index: number, brief: string, products?: string[]) =>
    post<{ ok: boolean }>(`/api/v1/brands/${slug}/editorial-plan/save-brief`, t, { week_index, brief, products }),

  // ── Weekly plan ───────────────────────────────────────────────────────

  planWeek: (t: string, slug: string, week_index: number) =>
    post<{ ok: boolean; draft: unknown }>(`/api/v1/brands/${slug}/weekly-plan/plan`, t, { week_index }),

  saveWeekDraft: (t: string, slug: string, draft_id: string, seeds: unknown[]) =>
    post<{ ok: boolean }>(`/api/v1/brands/${slug}/weekly-plan/save`, t, { draft_id, seeds }),

  produceWeek: (t: string, slug: string, draft_id: string, row_index?: number) =>
    post<{ ok: boolean; produced: number }>(`/api/v1/brands/${slug}/weekly-plan/produce`, t, { draft_id, row_index }),

  renderWeek: (t: string, slug: string, week_index?: number) =>
    post<{ ok: boolean; rendered: number; failed: number; results: { id: string; ok: boolean; url?: string; error?: string; product?: string; qc?: { score: number; pass: boolean; issues: string[]; retried: boolean } }[] }>(`/api/v1/brands/${slug}/weekly-plan/render`, t, week_index !== undefined ? { week_index } : {}),

  // ── Products ──────────────────────────────────────────────────────────
  listProducts: (t: string, slug: string) =>
    get<{ products: { id: string; title: string; kind: string; pricing: string | null; imageCount: number; featured: boolean }[] }>(`/api/v1/brands/${slug}/products`, t),

  syncProducts: (t: string, slug: string) =>
    post<{ ok: boolean; platform: string; synced: number }>(`/api/v1/brands/${slug}/products`, t),

  deletePostsByStatus: (t: string, slug: string, status: string) =>
    request<{ ok: boolean; deleted: number }>(`/api/v1/brands/${slug}/posts?status=${encodeURIComponent(status)}`, t, { method: 'DELETE' }),

  // ── GTM editing ───────────────────────────────────────────────────────

  updateGtmPlan: (t: string, slug: string, data: { objective?: string; phase_index?: number; phase_name?: string; phase_objective?: string; platform_weights?: unknown; pillars?: string[] }) =>
    post<{ ok: boolean }>(`/api/v1/brands/${slug}/gtm/update`, t, data),

  // ── Voice editing ─────────────────────────────────────────────────────

  updateVoice: (t: string, slug: string, data: { mood?: string; tone?: string; register?: number; emotion?: string; character?: string; syntax?: string; platform_instructions?: Record<string, string>; avoid?: string[] }) =>
    post<{ ok: boolean }>(`/api/v1/brands/${slug}/voice/update`, t, data),

  // ── Product editing ───────────────────────────────────────────────────

  updateProduct: (t: string, slug: string, productId: string, data: { title?: string; description?: string; pricing?: string; featured?: boolean }) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/products/${productId}`, t, { method: 'PUT', body: JSON.stringify(data) }),

  deleteProduct: (t: string, slug: string, productId: string) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/products/${productId}`, t, { method: 'DELETE' }),

  // ── Person editing ────────────────────────────────────────────────────

  updatePerson: (t: string, slug: string, personId: string, data: { name?: string; role?: string; description?: string; attributes?: unknown }) =>
    request<{ ok: boolean }>(`/api/v1/brands/${slug}/people/${personId}`, t, { method: 'PUT', body: JSON.stringify(data) }),

  // ── SEO ───────────────────────────────────────────────────────────────

  getSeo: (t: string, slug: string) => get<SeoData>(`/api/v1/brands/${slug}/seo`, t),

  seoAction: (t: string, slug: string, body: { action: string; initiativeId?: string; guidance?: string }) =>
    post<{ ok?: boolean; error?: string; grade?: string; initiatives?: number; added?: number; generated?: number; articleId?: string; techScore?: number | null }>(`/api/v1/brands/${slug}/seo`, t, body),

  // ── GEO ───────────────────────────────────────────────────────────────

  getGeo: (t: string, slug: string) => get<GeoData>(`/api/v1/brands/${slug}/geo`, t),

  geoAction: (t: string, slug: string, action: 'audit' | 'fix') =>
    post<{ ok?: boolean; techScore?: number | null; shareOfVoice?: number; generated?: number }>(`/api/v1/brands/${slug}/geo`, t, { action }),

  // ── Keywords ──────────────────────────────────────────────────────────

  getKeywords: (t: string, slug: string) => get<KeywordsData>(`/api/v1/brands/${slug}/keywords`, t),

  refreshKeywords: (t: string, slug: string) =>
    post<{ ok: boolean; keywords: number }>(`/api/v1/brands/${slug}/keywords`, t),

  // ── Web / Blog ────────────────────────────────────────────────────────

  getWeb: (t: string, slug: string, status?: string) =>
    get<{ articles: WebArticle[] }>(`/api/v1/brands/${slug}/web${status ? `?status=${status}` : ''}`, t),

  webAction: (t: string, slug: string, body: { action: string; topic?: string; id?: string }) =>
    post<{ ok?: boolean; articleId?: string; status?: string }>(`/api/v1/brands/${slug}/web`, t, body),

  // ── Ads ───────────────────────────────────────────────────────────────

  getAds: (t: string, slug: string) =>
    get<{
      summary: {
        campaigns: {
          id: string;
          name: string;
          platform: string;
          ad_type: string;
          status: string;
          goal: string;
          budget_amount: number;
          budget_type: string;
        }[];
        totals: { spend: number; impressions: number; clicks: number; active: number; proposed: number };
      };
      candidates: { platform: string; score: number; reason: string; caption: string | null }[];
      adAccounts: { id: string; platform: string; name: string | null; status: string; zernio_ad_account_id: string }[];
    }>(`/api/v1/brands/${slug}/ads`, t),

  adsAction: (
    t: string,
    slug: string,
    body: Record<string, unknown>
  ) =>
    post<{
      ok?: boolean;
      error?: string;
      created?: number;
      candidates?: number;
      zernioAdId?: string;
      accounts?: number;
      metrics?: number;
      id?: string;
      next?: 'active' | 'paused';
      copiedCampaignId?: string;
    }>(`/api/v1/brands/${slug}/ads`, t, body),

  // ── Chat ──────────────────────────────────────────────────────────────

  chat: async (t: string, slug: string, message: string): Promise<string> => {
    const res = await fetch(`${appUrl()}/app/${slug}/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: message }] }),
    });
    if (!res.ok) throw new Error(`Chat error: ${res.status}`);
    // Read streaming response
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    return result;
  },
};
