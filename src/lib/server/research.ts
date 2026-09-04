import { swallow } from '$lib/server/swallow';
import { GoogleGenAI } from '@google/genai';
import { genaiClient, fetchImagePart } from '$lib/server/brand-context';
import { fetchPage } from '$lib/server/brand-analysis';
import { scrapeForOnboarding, type ScrapeTarget, type ScrapedPost } from '$lib/server/scrapecreators';
import { aiStructured, aiText, parallelVariants } from '$lib/server/xiaomi';
import { requireBrandContext } from '$lib/server/ai-log';
import { type GeminiThinkingLevel } from '$lib/server/gemini';
import { exaConfigured, exaGroundedAnswer } from '$lib/server/exa';
import { tavilyConfigured, tavilyGroundedAnswer } from '$lib/server/tavily';
import { deepseekSearchConfigured, deepseekGroundedAnswer } from '$lib/server/deepseek-search';
import { llmGeminiSearchModel, llmImagesFromInline, llmStructured, llmText } from '$lib/server/llm';

// Deep-research module for onboarding: discover competitors (web-grounded), resolve their social
// handles, scrape + benchmark their posts, and synthesise a strategy report that both the user
// sees and the planner consumes. Runs SYNCHRONOUSLY before the first weekly draft.
//
// HARD CONSTRAINT (@google/genai 2.7.0): Google Search grounding (config.tools=[{googleSearch}])
// cannot be combined with responseSchema/JSON mode in the same call. So every grounded stage is a
// PAIR: groundedText() (free-text + web) → structured() (normalise into typed JSON). The two
// helpers below are the spine of that pattern; every stage reuses them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type Citation = { uri: string; title: string };

// ---- grounding spine ------------------------------------------------------------------------

// A web-grounded free-text call. Returns the model's prose + the de-duplicated web sources it
// cited, which the UI surfaces as "researched N sources". NO responseSchema.
// `ai` non viene più usato (la risposta arriva dai provider web, non da Gemini): la firma resta
// com'era perché cambiarla vorrebbe dire toccare tutti i chiamanti per togliere un argomento.
export async function groundedText(
  _ai: GoogleGenAI,
  prompt: string,
  systemInstruction?: string,
  opts?: { brandId?: string }
): Promise<{ text: string; citations: Citation[] }> {
  // Solo per il log: i provider web leggono il brand dal contesto async.
  requireBrandContext(opts);

  // NIENTE GOOGLE GROUNDING QUI. Prima questa funzione partiva da Gemini + googleSearch e teneva
  // gli altri come ripiego. Costava ~$0.07 a risposta ($14/1k query di ricerca PIÙ i token) contro
  // i $0.005-0.008 di Exa e Tavily: dieci volte tanto per una risposta che poi viene comunque
  // normalizzata da una seconda chiamata. Il motore di ricerca lo scegliamo per prezzo perché qui
  // nessuno misura CHI ha risposto — quando conta il nome del motore (audit GEO, "è citato il brand
  // nelle risposte di Gemini?") il chiamante usa groundedGemini, che sul gateway è un Gemini con
  // plugin web nativo, non lo SDK Google.
  //
  // Più provider e non uno solo perché il guasto tipico non è la rottura ma la raffica: Exa ha
  // risposto 192 volte su 241 in 14 giorni e ha rate-limitato (429) le altre 49, 44 delle quali in
  // una sola giornata storta. Ogni anello passa la mano su una risposta VUOTA, così una fase di
  // ricerca non può perdere in silenzio il suo passaggio sul web.
  //
  //     exa ~$0.005  ·  deepseek ~$0.0006-0.004  ·  tavily ~$0.008
  //
  // DeepSeek è il più economico ma fattura a token: una domanda difficile che gli fa fare sei
  // ricerche costa quanto Exa. In compenso è l'unico che cerca RIPETUTAMENTE per una sola domanda
  // (6 ricerche / 38 fonti su un confronto a due parti, in UNA chiamata), quindi è il secondo:
  // dove Exa non risponde, le domande composte tornano intere invece che a metà.
  const question = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;

  const webProviders: Array<[string, () => Promise<{ text: string; citations: Citation[] }>]> = [];
  if (exaConfigured()) webProviders.push(['exa', () => exaGroundedAnswer(question)]);
  if (deepseekSearchConfigured()) webProviders.push(['deepseek', () => deepseekGroundedAnswer(question)]);
  if (tavilyConfigured()) webProviders.push(['tavily', () => tavilyGroundedAnswer(question)]);
  for (const [name, call] of webProviders) {
    const res = await call().catch((error) => { swallow('call failed', error); return ({ text: '', citations: [] }); });
    if (res.text.trim()) return res;
    console.warn(`[AI] ${name} returned empty, trying the next web provider`);
  }

  console.warn('[AI] every web provider returned empty');
  return { text: '', citations: [] };
}

/**
 * Risposta web-grounded da un GEMINI sul centralino (plugin OpenRouter `web` + `engine: native`).
 *
 * Serve ai chiamanti che vogliono UN motore nominato, non il più economico: l'audit GEO misura
 * "il brand è citato nelle risposte di Gemini", quindi passarlo da groundedText etichettava una
 * risposta DeepSeek come Gemini. Bing usa llmText SENZA questo plugin: le fonti sono già gli URL Bing.
 */
export async function groundedGemini(
  _ai: GoogleGenAI,
  prompt: string,
  systemInstruction?: string,
  opts?: { brandId?: string }
): Promise<{ text: string; citations: Citation[] }> {
  requireBrandContext(opts);
  return llmText({
    prompt,
    system: systemInstruction,
    webSearch: true,
    model: llmGeminiSearchModel(),
    label: 'grounded'
  });
}

// JSON vincolato sul centralino. Firma invariata (il client Google non viene più usato) perché
// ogni call site passa già `ai` — toglierlo è un lotto a parte.
export async function structuredGemini<T>(
  _ai: GoogleGenAI,
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: AnyRec,
  systemInstruction?: string,
  opts?: {
    label?: string;
    images?: Array<{ inlineData: { mimeType: string; data: string } }>;
    temperature?: number;
    thinkingLevel?: GeminiThinkingLevel;
    brandId?: string;
    userId?: string;
    threadId?: string;
    context?: string;
  }
): Promise<T> {
  requireBrandContext(opts);
  const { label = 'structured', images, temperature } = opts ?? {};
  try {
    return await llmStructured<T>({
      prompt,
      schema,
      system: systemInstruction,
      images: llmImagesFromInline(images),
      temperature,
      label
    });
  } catch {
    return {} as T;
  }
}

// Provider-aware structured call: MiMo when GTM_PROVIDER=xiaomi (text→pro tier, images→vision
// tier), Gemini otherwise — with automatic Gemini fallback either way. Every structured caller
// in the codebase (blog, GEO, personas, normalisation, …) switches provider through this one door.
export async function structured<T>(
  ai: GoogleGenAI,
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: AnyRec,
  systemInstruction?: string,
  opts?: {
    label?: string;
    images?: Array<{ inlineData: { mimeType: string; data: string } }>;
    temperature?: number;
    model?: string;
    provider?: 'gemini' | 'xiaomi' | 'kie';
    noFallback?: boolean;
    /** How hard Gemini reasons on judge-style calls — see structuredGemini. */
    thinkingLevel?: GeminiThinkingLevel;
    brandId?: string;
    userId?: string;
    threadId?: string;
    context?: string;
  }
): Promise<T> {
  const { label = 'structured', ...rest } = opts ?? {};
  return aiStructured<T>(ai, prompt, schema, systemInstruction, label, rest);
}

// ---- shared types ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrandProfile = any;

export type CompetitorCandidate = {
  name: string;
  website: string;
  kind: 'direct' | 'indirect';
  rationale: string;
};

export type PostStats = {
  count: number;
  medianEngagement: number;
  avgEngagement: number;
  postsPerWeek: number;
  formatMix: { image: number; video: number; text: number };
  byPlatform: Record<string, { count: number; medianEngagement: number }>;
  topPosts: Array<{ content: string | null; platform: string; thumbnailUrl: string | null; engagement: number; metrics: AnyRec }>;
};

export type CompetitorBenchmark = { name: string; stats: PostStats };

export type Benchmark = {
  brand: PostStats | null;
  competitors: CompetitorBenchmark[];
  market: { medianEngagement: number; postsPerWeek: number; formatMix: { image: number; video: number; text: number } };
};

export type StrategyReport = {
  summary: string;
  competitiveLandscape: string;
  whiteSpace: string[];
  differentiators: string[];
  threats: string[];
  recommendedAngles: string[];
  platformGuidance: Array<{ platform: string; recommendation: string; why: string }>;
};

// Caps — keep the synchronous pipeline tolerable. Tune here.
export const MAX_COMPETITORS = 5;
const COMPETITOR_SCRAPE_LIMITS = { maxPages: 2, maxPosts: 30 };
const MAX_QUAL_IMAGES = 8;

// ---- Stage A: competitor discovery (GROUNDED → STRUCTURED) ----------------------------------

const DISCOVERY_SCHEMA = {
  type: 'object' as const,
  properties: {
    competitors: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          website: { type: 'string' as const, description: 'Root domain incl. https://, or "" if unknown' },
          kind: { type: 'string' as const, enum: ['direct', 'indirect'] as const },
          rationale: { type: 'string' as const, description: 'One line: why this brand competes with the target' }
        },
        required: ['name', 'website', 'kind', 'rationale']
      }
    }
  },
  required: ['competitors']
};

// Find 3-5 real direct/indirect competitors via web search, then normalise to typed candidates.
export async function discoverCompetitors(
  ai: GoogleGenAI,
  profile: BrandProfile,
  // Language for the user-facing rationale prose (follows the site locale). Defaults to English.
  outputLanguage = 'English'
): Promise<{ competitors: CompetitorCandidate[]; citations: Citation[] }> {
  const products = Array.isArray(profile?.products)
    ? profile.products.slice(0, 8).map((p: BrandProfile) => p?.name ?? p?.title).filter(Boolean).join(', ')
    : '';
  const grounded = await groundedText(
    ai,
    `Find the real competitors of this brand using current web information.

Brand: ${profile?.name ?? ''}
Website: ${profile?.url ?? profile?.website ?? ''}
Category: ${profile?.category ?? ''}
What they do: ${profile?.about ?? ''}
${profile?.ai_context ? `Context from their own social posts (for creators without a website):\n${String(profile.ai_context).slice(0, 1200)}\n` : ''}Target audience: ${profile?.target_audience ?? ''}
Products: ${products || 'n/a'}
Market/language: ${profile?.language ?? ''}

List 3-5 REAL competitors that actually exist. Prefer brands of comparable size and the SAME market/region. Include both DIRECT competitors (same product/audience) and 1-2 INDIRECT ones (solve the same need differently). For each give: name, official website, whether it's direct or indirect, and one line on why it competes. Do not invent brands. Write the "why it competes" rationale in ${outputLanguage} (keep brand names and websites exactly as they are).`,
    'You are a market analyst. Use web search to find real, currently-operating competitors. Never fabricate companies.'
  );

  const norm = await structured<{ competitors: CompetitorCandidate[] }>(
    ai,
    `From the analysis below, extract the competitors as structured data. Keep only real named brands; drop vague mentions. Normalise websites to "https://domain" form (empty string if none was given). Write each rationale in ${outputLanguage}; keep brand names and websites unchanged.\n\nANALYSIS:\n${grounded.text}`,
    DISCOVERY_SCHEMA
  );

  const competitors = (norm.competitors ?? [])
    .filter((c) => c?.name)
    .slice(0, MAX_COMPETITORS)
    .map((c) => ({
      name: String(c.name).trim(),
      website: String(c.website ?? '').trim(),
      kind: c.kind === 'indirect' ? ('indirect' as const) : ('direct' as const),
      rationale: String(c.rationale ?? '').trim()
    }));

  return { competitors, citations: grounded.citations };
}

// ---- Stage B: resolve competitor social handles (site scrape → grounded fallback) -----------

// Per-platform patterns to lift a handle from a competitor's website HTML. Keys match the
// scrapecreators FETCHERS ('x' = twitter/x). profileUrl is rebuilt canonically.
const SOCIAL_PATTERNS: Record<string, RegExp> = {
  instagram: /(?:https?:)?\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|reels\/|explore\/|stories\/)([A-Za-z0-9_.]+)/i,
  tiktok: /(?:https?:)?\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9_.]+)/i,
  x: /(?:https?:)?\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|hashtag)([A-Za-z0-9_]+)/i,
  threads: /(?:https?:)?\/\/(?:www\.)?threads\.(?:net|com)\/@([A-Za-z0-9_.]+)/i,
  facebook: /(?:https?:)?\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog)([A-Za-z0-9_.]+)/i,
  youtube: /(?:https?:)?\/\/(?:www\.)?youtube\.com\/(@[A-Za-z0-9_.-]+|channel\/[A-Za-z0-9_-]+|c\/[A-Za-z0-9_-]+)/i,
  linkedin: /(?:https?:)?\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([A-Za-z0-9_-]+)/i
};

function canonicalProfileUrl(platform: string, raw: string): string {
  const h = raw.replace(/^@/, '');
  switch (platform) {
    case 'instagram': return `https://instagram.com/${h}`;
    case 'tiktok': return `https://tiktok.com/@${h}`;
    case 'x': return `https://x.com/${h}`;
    case 'threads': return `https://threads.net/@${h}`;
    case 'facebook': return `https://facebook.com/${h}`;
    case 'youtube': return raw.startsWith('@') ? `https://youtube.com/${raw}` : `https://youtube.com/${raw}`;
    case 'linkedin': return `https://linkedin.com/company/${h}`;
    default: return raw;
  }
}

// Extract whatever social handles appear in a website's HTML, limited to the platforms we care about.
export function extractSocialHandles(html: string, platforms: string[]): ScrapeTarget[] {
  const out: ScrapeTarget[] = [];
  for (const platform of platforms) {
    const re = SOCIAL_PATTERNS[platform];
    if (!re) continue;
    const m = html.match(re);
    if (!m?.[1]) continue;
    const username = m[1].replace(/^@/, '');
    out.push({ platform, username, profileUrl: canonicalProfileUrl(platform, m[1]) });
  }
  return out;
}

const HANDLES_SCHEMA = {
  type: 'object' as const,
  properties: {
    handles: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Competitor name exactly as given' },
          platform: { type: 'string' as const },
          username: { type: 'string' as const, description: 'Handle without @, or "" if unknown' }
        },
        required: ['name', 'platform', 'username']
      }
    }
  },
  required: ['handles']
};

// Resolve each confirmed competitor's handles for the selected platforms. HTML scrape first
// (cheap), then ONE batched grounded call for whatever's still missing. Parallel, best-effort.
export async function resolveCompetitorHandles(
  ai: GoogleGenAI,
  competitors: CompetitorCandidate[],
  platforms: string[]
): Promise<Map<string, ScrapeTarget[]>> {
  const wanted = platforms.filter((p) => SOCIAL_PATTERNS[p]);
  const map = new Map<string, ScrapeTarget[]>();

  // 1) Scrape each competitor's homepage for social links (parallel, best-effort).
  await Promise.all(
    competitors.map(async (c) => {
      let found: ScrapeTarget[] = [];
      if (c.website) {
        try {
          const html = await fetchPage(c.website);
          if (html) found = extractSocialHandles(html, wanted);
        } catch (error) { swallow('fetch competitor site handles', error); }
      }
      map.set(c.name, found);
    })
  );

  // 2) Parallel grounded fallback: search for each competitor's missing handles in parallel.
  const missing = competitors.flatMap((c) => {
    const have = new Set((map.get(c.name) ?? []).map((h) => h.platform));
    return wanted.filter((p) => !have.has(p)).map((p) => ({ name: c.name, platform: p }));
  });

  if (missing.length) {
    // Group missing handles by competitor and search in parallel
    const byCompetitor = new Map<string, string[]>();
    for (const m of missing) {
      if (!byCompetitor.has(m.name)) byCompetitor.set(m.name, []);
      byCompetitor.get(m.name)!.push(m.platform);
    }

    try {
      const allHandles = (await Promise.all(
        [...byCompetitor.entries()].map(async ([name, platforms]) => {
          try {
            const grounded = await groundedText(
              ai,
              `Find the OFFICIAL ${platforms.join(', ')} social media handles for ${name}. Only report if confident it's the real, official account. Return each as "Brand — platform — @handle" (or "unknown").`,
              'You verify official social accounts via web search. Never guess; say unknown if unsure.'
            );
            const norm = await structured<{ handles: Array<{ name: string; platform: string; username: string }> }>(
              ai,
              `Extract the handles from the text below as structured data. username without @, empty string if unknown.\n\n${grounded.text}`,
              HANDLES_SCHEMA
            );
            return norm.handles ?? [];
          } catch {
            return [];
          }
        })
      )).flat();

      for (const h of allHandles) {
        const username = String(h?.username ?? '').replace(/^@/, '').trim();
        if (!username || !SOCIAL_PATTERNS[h.platform]) continue;
        const list = map.get(h.name);
        if (!list) continue;
        if (list.some((x) => x.platform === h.platform)) continue;
        list.push({ platform: h.platform, username, profileUrl: canonicalProfileUrl(h.platform, username) });
      }
    } catch (error) { swallow('search social handle fallback', error); }
  }

  return map;
}

// ---- Stage C: scrape competitor posts (REUSE scrapecreators global cache) --------------------

// Per-competitor scrape so posts are unambiguously owned (scrapeForOnboarding tags posts only by
// platform, so we scrape each competitor separately and keep ownership). Parallel across
// competitors; every handle goes through the cached scrapeForOnboarding (near-free if seen before).
export async function scrapeCompetitors(
  handlesByName: Map<string, ScrapeTarget[]>
): Promise<Map<string, ScrapedPost[]>> {
  const entries = [...handlesByName.entries()];
  const scraped = await Promise.all(
    entries.map(async ([name, handles]) => {
      if (!handles.length) return [name, [] as ScrapedPost[]] as const;
      try {
        const { posts } = await scrapeForOnboarding(handles, COMPETITOR_SCRAPE_LIMITS);
        return [name, posts] as const;
      } catch {
        return [name, [] as ScrapedPost[]] as const;
      }
    })
  );
  return new Map(scraped);
}

// ---- Stage D: quantitative benchmark (PURE CODE) --------------------------------------------

function engagementOf(p: { metrics: AnyRec }): number {
  const m = p.metrics ?? {};
  return (Number(m.likes) || 0) + (Number(m.comments) || 0) + (Number(m.shares) || 0);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function statsFor(posts: ScrapedPost[]): PostStats {
  const engagements = posts.map(engagementOf);
  const total = posts.length || 1;
  const fmt = { image: 0, video: 0, text: 0 };
  for (const p of posts) {
    if (p.mediaType === 'video') fmt.video++;
    else if (p.mediaType === 'text') fmt.text++;
    else fmt.image++;
  }
  // Posting cadence from the published-at span.
  const times = posts.map((p) => (p.publishedAt ? new Date(p.publishedAt).getTime() : NaN)).filter((t) => !Number.isNaN(t));
  let postsPerWeek = 0;
  if (times.length >= 2) {
    const spanMs = Math.max(...times) - Math.min(...times);
    const weeks = Math.max(spanMs / (7 * 24 * 3600 * 1000), 1 / 7);
    postsPerWeek = Math.round((posts.length / weeks) * 10) / 10;
  }
  const byPlatform: Record<string, { count: number; medianEngagement: number }> = {};
  for (const plat of new Set(posts.map((p) => p.platform))) {
    const pe = posts.filter((p) => p.platform === plat);
    byPlatform[plat] = { count: pe.length, medianEngagement: median(pe.map(engagementOf)) };
  }
  const topPosts = [...posts]
    .map((p) => ({ content: p.content, platform: p.platform, thumbnailUrl: p.thumbnailUrl, engagement: engagementOf(p), metrics: p.metrics ?? {} }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 3);
  return {
    count: posts.length,
    medianEngagement: median(engagements),
    avgEngagement: Math.round(engagements.reduce((a, b) => a + b, 0) / total),
    postsPerWeek,
    formatMix: { image: fmt.image / total, video: fmt.video / total, text: fmt.text / total },
    byPlatform,
    topPosts
  };
}

export function benchmarkCompetitors(
  brandPosts: ScrapedPost[],
  competitorPosts: Map<string, ScrapedPost[]>
): Benchmark {
  const competitors: CompetitorBenchmark[] = [...competitorPosts.entries()]
    .filter(([, posts]) => posts.length)
    .map(([name, posts]) => ({ name, stats: statsFor(posts) }));

  const allCompPosts = [...competitorPosts.values()].flat();
  const marketStats = statsFor(allCompPosts);

  return {
    brand: brandPosts.length ? statsFor(brandPosts) : null,
    competitors,
    market: { medianEngagement: marketStats.medianEngagement, postsPerWeek: marketStats.postsPerWeek, formatMix: marketStats.formatMix }
  };
}

// ---- Stage E: qualitative positioning analysis (LLM, MULTIMODAL) ----------------------------

// Look at the top competitor posts (captions + a few thumbnails) and describe how the field
// positions itself: angles, visual language, tone, recurring hooks. Free-text, no grounding.
export async function analyzeCompetitorContent(ai: GoogleGenAI, benchmark: Benchmark, outputLanguage = 'English'): Promise<string> {
  const captionLines: string[] = [];
  const thumbUrls: string[] = [];
  for (const c of benchmark.competitors) {
    for (const tp of c.stats.topPosts) {
      if (tp.content) captionLines.push(`- [${c.name} · ${tp.platform} · ${tp.engagement} eng] ${tp.content.replace(/\s+/g, ' ').slice(0, 200)}`);
      if (tp.thumbnailUrl) thumbUrls.push(tp.thumbnailUrl);
    }
  }
  if (!captionLines.length && !thumbUrls.length) return '';

  const imageParts = (await Promise.all(thumbUrls.slice(0, MAX_QUAL_IMAGES).map(fetchImagePart))).filter(Boolean) as Array<{ inlineData: { mimeType: string; data: string } }>;
  const prompt = `These are top-performing social posts from a brand's competitors (captions below; some thumbnails attached). In ~250 words describe how this competitive field positions itself: dominant content angles & pillars, visual language, tone of voice, recurring hooks/CTAs, and what they all seem to compete on (price? status? education? community?). Be concrete and comparative. Write the analysis in ${outputLanguage}. Use light Markdown (short ## headings, **bold** key phrases, and bullet lists) so it reads cleanly. Output only the analysis.\n\nCAPTIONS:\n${captionLines.join('\n') || '(none)'}`;

  try {
    return (await aiText(ai, prompt, undefined, { label: 'competitorQualitative', images: imageParts })).trim();
  } catch {
    return '';
  }
}

// ---- Stage F (+G merged): brand strategy report (STRUCTURED) --------------------------------

const REPORT_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string' as const, description: 'A tight paragraph: where the brand sits vs the market and the core strategic bet.' },
    competitiveLandscape: { type: 'string' as const, description: 'How competitors position; saturation and patterns.' },
    whiteSpace: { type: 'array' as const, items: { type: 'string' as const }, description: 'Specific openings nobody owns that this brand can take.' },
    differentiators: { type: 'array' as const, items: { type: 'string' as const }, description: "The brand's real edges to lean into." },
    threats: { type: 'array' as const, items: { type: 'string' as const } },
    recommendedAngles: { type: 'array' as const, items: { type: 'string' as const }, description: 'Concrete content angles/themes for the coming posts.' },
    platformGuidance: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          platform: { type: 'string' as const },
          recommendation: { type: 'string' as const, description: 'invest | maintain | test | skip + one line' },
          why: { type: 'string' as const }
        },
        required: ['platform', 'recommendation', 'why']
      }
    }
  },
  required: ['summary', 'competitiveLandscape', 'whiteSpace', 'differentiators', 'threats', 'recommendedAngles', 'platformGuidance']
};

// Exported: the editorial-plan proposer reuses this digest to ground cadence + GTM platform
// recommendations in the same market numbers the strategy report sees.
export function benchmarkDigest(b: Benchmark): string {
  const fmt = (s: { image: number; video: number; text: number }) =>
    `img ${Math.round(s.image * 100)}% / vid ${Math.round(s.video * 100)}% / text ${Math.round(s.text * 100)}%`;
  const lines: string[] = [];
  if (b.brand) lines.push(`BRAND: ${b.brand.count} posts, median eng ${b.brand.medianEngagement}, ${b.brand.postsPerWeek}/wk, ${fmt(b.brand.formatMix)}`);
  lines.push(`MARKET (all competitors): median eng ${b.market.medianEngagement}, ${b.market.postsPerWeek}/wk, ${fmt(b.market.formatMix)}`);
  for (const c of b.competitors) {
    const plats = Object.entries(c.stats.byPlatform).map(([p, v]) => `${p}:${v.medianEngagement}`).join(', ');
    lines.push(`- ${c.name}: ${c.stats.count} posts, median eng ${c.stats.medianEngagement}, ${c.stats.postsPerWeek}/wk, ${fmt(c.stats.formatMix)}${plats ? ` [${plats}]` : ''}`);
  }
  return lines.join('\n');
}

export async function synthesizeStrategyReport(
  ai: GoogleGenAI,
  profile: BrandProfile,
  benchmark: Benchmark,
  qualitative: string,
  platforms: string[],
  outputLanguage = 'English',
  opts?: { model?: string; variants?: number }
): Promise<StrategyReport> {
  const systemInstruction = 'You are an expert competitive strategist. Be concrete, comparative, and honest about gaps.';
  const model = opts?.model;
  const variants = Math.max(1, opts?.variants ?? 3);

  const makePrompt = () => `You are a senior social-media strategist. Produce a sharp positioning & strategy report for this brand versus its competitors. Ground every claim in the data; do not invent metrics.

BRAND: ${profile?.name ?? ''}
About: ${profile?.about ?? ''}
Category: ${profile?.category ?? ''}
Target audience: ${profile?.target_audience ?? ''}
Brand voice/context: ${profile?.ai_context ?? '(none yet)'}
Platforms the brand will use: ${platforms.join(', ') || 'n/a'}

QUANTITATIVE BENCHMARK:
${benchmarkDigest(benchmark)}

QUALITATIVE FIELD ANALYSIS:
${qualitative || '(none)'}

Write: a summary, the competitive landscape, concrete WHITE SPACE openings the brand can own, the brand's differentiators, threats, recommended content angles, and platform guidance (one entry per platform the brand will use, recommendation = invest/maintain/test/skip with a why grounded in the benchmark). Be specific and actionable. Write ALL prose (summary, landscape, white space, differentiators, threats, angles, and every platform "why") in ${outputLanguage}; keep the platform names themselves unchanged.
Return JSON.`;

  const report = await parallelVariants<StrategyReport>(
    ai,
    () => aiStructured<StrategyReport>(ai, makePrompt(), REPORT_SCHEMA, systemInstruction, 'return_strategy_report', { model }),
    async (picked) => {
      if (picked.length === 1) return picked[0];
      const summaries = picked.map((v, i) => `\nOPTION ${i + 1}:\nSummary: ${v.summary}\nWhite space: ${(Array.isArray(v.whiteSpace) ? v.whiteSpace : []).join('; ')}\nAngles: ${(Array.isArray(v.recommendedAngles) ? v.recommendedAngles : []).join('; ')}\nDifferentiators: ${(Array.isArray(v.differentiators) ? v.differentiators : []).join('; ')}`).join('\n---');
      const prompt = `Compare these ${picked.length} strategy reports and pick the BEST one. Consider: specificity, data-grounding, actionable recommendations, honest assessment.\n${summaries}\nReturn JSON: { "winner": <1-based index> }`;
      const schema = { type: 'object' as const, properties: { winner: { type: 'number' as const } }, required: ['winner'] };
      try {
        const raw = await aiStructured<{ winner?: number }>(ai, prompt, schema, systemInstruction, 'pick_best', { model });
        const idx = Math.max(0, Math.min(picked.length - 1, (raw?.winner ?? 1) - 1));
        return picked[idx];
      } catch { return picked[0]; }
    },
    variants,
    'strategy_report'
  );

  return {
    summary: report.summary ?? '',
    competitiveLandscape: report.competitiveLandscape ?? '',
    whiteSpace: report.whiteSpace ?? [],
    differentiators: report.differentiators ?? [],
    threats: report.threats ?? [],
    recommendedAngles: report.recommendedAngles ?? [],
    platformGuidance: report.platformGuidance ?? []
  };
}

// ---- Stage H: competitive context (PURE — fold the report into the planner's brief) ---------

// The COMPETITIVE DELTA block alone — a market-awareness section to append to a brand's ai_context.
// Pure string assembly (the report is already synthesised). Reused at plan time AND at persistence
// time (rebuildBrandContext) so the competitive framing survives future context rebuilds.
export function competitiveDelta(report: StrategyReport): string {
  const lines = [
    report.differentiators?.length ? `Lean into: ${(Array.isArray(report.differentiators) ? report.differentiators : []).join('; ')}.` : '',
    report.whiteSpace?.length ? `Own this white space: ${(Array.isArray(report.whiteSpace) ? report.whiteSpace : []).join('; ')}.` : '',
    report.recommendedAngles?.length ? `Prioritise these angles: ${(Array.isArray(report.recommendedAngles) ? report.recommendedAngles : []).join('; ')}.` : '',
    report.threats?.length ? `Avoid the crowded/risky moves: ${report.threats.join('; ')}.` : ''
  ].filter(Boolean);
  return lines.length ? `COMPETITIVE DELTA (how to stand out from competitors):\n${lines.join('\n')}` : '';
}

// Append the competitive delta to the brand's existing ai_context so the planner plans with market
// awareness.
export function buildCompetitiveContext(baseAiContext: string | undefined, report: StrategyReport): string {
  return [baseAiContext, competitiveDelta(report)].filter(Boolean).join('\n\n');
}

// A compact strategy brief fed to planStrategy (whiteSpace + recommended angles + threats — the
// actionable bits). Carries the SAME signal as competitiveDelta, so a planner receiving this brief
// does not also need the delta folded into its ai_context (double injection over-weights it).
export function strategyBriefFromReport(report: StrategyReport): string {
  return [
    (Array.isArray(report.recommendedAngles) && report.recommendedAngles.length) ? `Recommended angles this batch: ${report.recommendedAngles.join('; ')}.` : '',
    (Array.isArray(report.whiteSpace) && report.whiteSpace.length) ? `White space to claim: ${report.whiteSpace.join('; ')}.` : '',
    (Array.isArray(report.differentiators) && report.differentiators.length) ? `Differentiators: ${report.differentiators.join('; ')}.` : '',
    (Array.isArray(report.threats) && report.threats.length) ? `Avoid the crowded/risky moves: ${report.threats.join('; ')}.` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

// Generate 4 buyer personas for the brand based on profile, competitors, and platforms
export type BuyerPersona = {
  name: string;
  role: string;
  objectives: string[];
  painPoints: string[];
  preferredChannels: string[];
  imageUrl?: string;
};

// Compact "AUDIENCE PERSONAS" block from the stored Buyer Personas document (a JSON blob in
// brand_documents), so the personas actually STEER strategy/planning instead of being a display-only
// artifact. Pure + tolerant: '' on missing/malformed input, so a bad doc never breaks a stage.
export function personasDigest(contentText: string | null | undefined): string {
  try {
    const arr = JSON.parse(String(contentText ?? '')) as BuyerPersona[];
    if (!Array.isArray(arr) || !arr.length) return '';
    const lines = arr
      .slice(0, 4)
      .map((p) => {
        const name = String(p?.name ?? '').trim();
        if (!name) return '';
        const bits = [
          p?.role ? String(p.role).trim() : '',
          Array.isArray(p?.objectives) && p.objectives.length ? `wants: ${p.objectives.slice(0, 2).join('; ')}` : '',
          Array.isArray(p?.painPoints) && p.painPoints.length ? `pains: ${p.painPoints.slice(0, 2).join('; ')}` : '',
          Array.isArray(p?.preferredChannels) && p.preferredChannels.length ? `channels: ${p.preferredChannels.slice(0, 3).join(', ')}` : ''
        ].filter(Boolean);
        return `- ${name}${bits.length ? ` (${bits.join(' · ')})` : ''}`;
      })
      .filter(Boolean);
    return lines.length ? `AUDIENCE PERSONAS (who the content must win over):\n${lines.join('\n')}` : '';
  } catch {
    return '';
  }
}

export async function generateBuyerPersonas(
  ai: GoogleGenAI,
  profile: AnyRec,
  competitors: { name: string }[],
  platforms: string[],
  outputLanguage = 'English'
): Promise<BuyerPersona[]> {
  const competitorNames = competitors.map((c) => c.name).join(', ');

  const prompt = `You are a buyer persona specialist. Based on this brand profile, generate 4 distinct buyer personas for "${profile.name}" (${profile.category || profile.about || 'unknown category'}).

Competitors: ${competitorNames}
Platforms: ${platforms.join(', ')}
Target audience hints: ${profile.target_audience || 'not specified'}

For each persona, provide:
1. A realistic first name (e.g., "Sarah", "Marcus")
2. Job title / role (e.g., "Marketing Manager", "Freelance Designer")
3. 2 main objectives (what they want to achieve)
4. 2 main pain points (what frustrates them)
5. 2 preferred channels (from: ${platforms.join(', ')}, email, podcast, etc)

Output as JSON array with this structure:
[
  {
    "name": "FirstName",
    "role": "Job Title",
    "objectives": ["objective 1", "objective 2"],
    "painPoints": ["pain point 1", "pain point 2"],
    "preferredChannels": ["channel1", "channel2"]
  }
]

Output ONLY the JSON array, no markdown, no explanation.`;

  // The schema is what makes this WORK: structured() requires one, and the old 2-arg call left
  // responseSchema undefined → free-text reply → JSON.parse fell back to {} → the caller's .map
  // threw → personas silently came back empty on every run.
  const PERSONAS_SCHEMA = {
    type: 'array' as const,
    items: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        role: { type: 'string' as const },
        objectives: { type: 'array' as const, items: { type: 'string' as const } },
        painPoints: { type: 'array' as const, items: { type: 'string' as const } },
        preferredChannels: { type: 'array' as const, items: { type: 'string' as const } }
      },
      required: ['name', 'role', 'objectives', 'painPoints', 'preferredChannels']
    }
  };
  const result = await structured<BuyerPersona[]>(ai, prompt, PERSONAS_SCHEMA);
  if (!Array.isArray(result)) return [];

  // Fetch images from Unsplash for each persona
  const personasWithImages = await Promise.all(
    result.map(async (persona) => {
      try {
        const imageUrl = await fetchUnsplashImage(persona.name, persona.role);
        return { ...persona, imageUrl };
      } catch {
        return persona;
      }
    })
  );

  return personasWithImages;
}

// Fetch a random image from Unsplash matching a query
async function fetchUnsplashImage(name: string, role: string): Promise<string> {
  const query = encodeURIComponent(`${role} professional`);
  const url = `https://api.unsplash.com/photos/random?query=${query}&orientation=portrait&w=400&h=500&client_id=${process.env.UNSPLASH_ACCESS_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const data = (await res.json()) as AnyRec;
    return data?.urls?.regular ?? '';
  } catch {
    return '';
  }
}

export { genaiClient };
