import { swallow } from '$lib/server/swallow';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoogleGenAI } from '@google/genai';
import { fetchPage } from './brand-analysis';
import { genaiClient, structured } from './research';
import { exaConfigured, exaGroundedAnswer } from './exa';
import { llmText, type WebSearchMode } from '$lib/server/llm';
import {
  fetchSearchPerformance,
  fetchBacklinkSummary,
  fetchHistoricalRankOverview,
  fetchBacklinkHistory,
  fetchSerpSnapshot,
  type SearchPerformance,
  type BacklinkSummary
} from './dataforseo';
import { withBrandContext } from './ai-log';
import { env } from '$env/dynamic/private';
import {
  antiCitationSignalsOf,
  corroborationOf,
  entityClarityOf,
  evidenceDensityOf,
  extractabilityOf,
  geoCitability
} from '$lib/server/geo-levers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// ── GEO (Generative Engine Optimization) — Level 1: technical audit ─────────────────────────────
//
// Is a brand's site CRAWLABLE and CITABLE by LLMs (ChatGPT, Perplexity, Google AI Overviews)? This
// module answers that deterministically — no AI calls, no cost — by fetching a handful of well-known
// URLs and inspecting them: /llms.txt, robots.txt (are the AI crawlers blocked?), JSON-LD structured
// data, sitemap, and basic meta. Pure parse functions (testable against fixtures) + one orchestrator
// that fetches via the SSRF-safe fetchPage. Level 2 (citation share-of-voice) reuses research.ts.

export type GeoSeverity = 'high' | 'medium' | 'low';
export type GeoIssue = { id: string; severity: GeoSeverity; title: string; detail: string; fix: string };

export type GeoTechAudit = {
  score: number; // 0-100
  llmsTxt: boolean;
  aiCrawlers: Array<{ bot: string; blocked: boolean }>;
  structuredDataTypes: string[];
  /** Whether the site sells, and how complete its offer layer is. See `commerceReadiness`. */
  commerce: CommerceRead;
  sitemapUrls: number;
  meta: { title: boolean; description: boolean; canonical: boolean; ogTitle: boolean };
  content: GeoContentAnalysis;
  responseMs: number | null; // homepage TTFB, measured by the orchestrator
  issues: GeoIssue[];
  /**
   * The raw homepage HTML, carried out of `auditSiteTech` so the citability levers can read it
   * without paying for a second fetch. Transient: stripped before the snapshot is persisted.
   */
  homepageHtml?: string;
};

// ── content quality (on-page SEO + AI readability) ────────────────────────────────────────────────

export type ContentStatus = 'good' | 'warn' | 'bad';

export type GeoContentAnalysis = {
  title: string | null;
  titleLength: number;
  description: string | null;
  descriptionLength: number;
  h1Count: number;
  wordCount: number;
  textRatio: number; // % readable text vs total HTML
  // extended checks
  openGraph: { image: boolean; description: boolean; type: boolean; url: boolean };
  headingLevels: number[];      // ordered list of heading levels (e.g. [1,2,2,3,2])
  headingJumps: number;         // count of jumps >1 level (H1→H3 is a jump of 2)
  imagesTotal: number;
  imagesWithAlt: number;
  imagesWithoutAlt: number;
  internalLinks: number;
  externalLinks: number;
  metaRobotsNoindex: boolean;
  qaBlocks: number;             // count of question-like sentences in the readable text
  hasNap: boolean;              // phone or address detected (Name/Address/Phone trust signal)
  htmlLang: string | null;
  statuses: {
    title: ContentStatus;
    description: ContentStatus;
    h1: ContentStatus;
    depth: ContentStatus;
    ratio: ContentStatus;
    openGraph: ContentStatus;
    headings: ContentStatus;
    images: ContentStatus;
    links: ContentStatus;
    robots: ContentStatus;
    qa: ContentStatus;
    nap: ContentStatus;
    lang: ContentStatus;
  };
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
}

// Strip scripts, styles, comments and tags → plain readable text.
function stripToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<template[\s\S]*?<\/template>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/?[a-z][^>]*>/gi, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

// ── extended content parsers (each pure & independently testable) ────────────────────────────────

// Open Graph completeness beyond og:title (which metaBasics already checks).
export function openGraphTags(html: string): { image: boolean; description: boolean; type: boolean; url: boolean } {
  return {
    image: /<meta[^>]+property=["']og:image["']/i.test(html),
    description: /<meta[^>]+property=["']og:description["']/i.test(html),
    type: /<meta[^>]+property=["']og:type["']/i.test(html),
    url: /<meta[^>]+property=["']og:url["']/i.test(html)
  };
}

// Ordered heading levels → detect structural jumps (H1→H3 skips H2). LLMs use heading hierarchy to
// segment and understand content; large jumps indicate messy structure.
export function headingHierarchy(html: string): { levels: number[]; jumps: number } {
  const levels: number[] = [];
  const re = /<h([1-6])[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) levels.push(Number(m[1]));
  let jumps = 0;
  for (let i = 1; i < levels.length; i++) {
    const diff = levels[i] - levels[i - 1];
    if (diff > 1) jumps++;
  }
  return { levels, jumps };
}

// Image alt-text coverage. AI engines can't "see" images — alt is the only bridge.
export function imageAltCoverage(html: string): { total: number; withAlt: number; withoutAlt: number } {
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const total = imgs.length;
  let withAlt = 0;
  for (const tag of imgs) {
    const altMatch = tag.match(/\balt=["']([^"']*)["']/i);
    if (altMatch && altMatch[1].trim()) withAlt++;
  }
  return { total, withAlt, withoutAlt: total - withAlt };
}

// Internal vs external link count from the homepage (href begin with http/https = external).
export function linkStats(html: string, origin = ''): { internal: number; external: number } {
  const hrefs = html.match(/<a\b[^>]+href=["']([^"']+)["']/gi) ?? [];
  let internal = 0, external = 0;
  const originHost = origin ? (() => { try { return new URL(origin).hostname; } catch { return ''; } })() : '';
  for (const match of hrefs) {
    const hm = match.match(/href=["']([^"']+)["']/i);
    if (!hm) continue;
    const href = hm[1];
    if (/^(https?:)?\/\//i.test(href)) {
      if (originHost && href.includes(originHost)) internal++;
      else external++;
    } else if (href.startsWith('/') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      internal++;
    }
  }
  return { internal, external };
}

// Meta robots tag — noindex is catastrophic for discoverability.
export function metaRobotsNoindex(html: string): boolean {
  const m = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i);
  if (!m) return false;
  return /\bnoindex\b/i.test(m[1]);
}

// Count question-like blocks in readable text (sentences ending in ? or starting with question words).
// FAQ-style content is among the most-cited formats in AI answers.
export function qaContentCount(text: string): number {
  const questions = text.match(/\b[^.!?]{8,}\?/g) ?? [];
  return questions.length;
}

// Detect NAP (Name/Address/Phone) trust signals. Looks for phone numbers and street-address patterns.
export function hasNapData(html: string): boolean {
  const phone = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/.test(html);
  const address = /\b(via|street|st|avenue|ave|road|rd|boulevard|blvd|strasse|platz|corso|piazza)\b\.?\s+\S+\s+\d/i.test(html)
    || /\b\d{1,5}\s+(via|street|st|avenue|ave|road|rd|corso|piazza)\b/i.test(html);
  const email = /mailto:|@\w+\.\w{2,}/.test(html);
  return phone || address || email;
}

// <html lang="..."> — AI engines segment by language.
export function htmlLangAttr(html: string): string | null {
  const m = html.match(/<html[^>]+lang=["']([a-zA-Z-]+)["']/i);
  return m ? m[1] : null;
}

// Extract the on-page SEO elements + evaluate their quality deterministically. Pure & testable.
export function analyzeContent(html: string): GeoContentAnalysis {
  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : null;
  const titleLength = title?.length ?? 0;

  // Meta description
  const descTag = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  let description: string | null = null;
  if (descTag) {
    const cm = descTag[0].match(/content=["']([^"']*)["']/i);
    description = cm ? decodeEntities(cm[1]).trim() : '';
  }
  const descriptionLength = description?.length ?? 0;

  // H1
  const h1Tags = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) ?? [];
  const h1Count = h1Tags.length;

  // Readable text
  const text = stripToText(html);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const textRatio = html.length ? Math.round((text.length / html.length) * 100) : 0;

  // Extended checks
  const og = openGraphTags(html);
  const ogCount = [og.image, og.description, og.type, og.url].filter(Boolean).length;
  const headings = headingHierarchy(html);
  const imgs = imageAltCoverage(html);
  const links = linkStats(html);
  const noindex = metaRobotsNoindex(html);
  const qa = qaContentCount(text);
  const nap = hasNapData(html);
  const lang = htmlLangAttr(html);

  const titleStatus: ContentStatus = !title ? 'bad' : titleLength < 30 ? 'warn' : titleLength <= 60 ? 'good' : 'warn';
  const descStatus: ContentStatus = !description ? 'bad' : descriptionLength < 120 ? 'warn' : descriptionLength <= 160 ? 'good' : 'warn';
  const h1Status: ContentStatus = h1Count === 1 ? 'good' : 'warn';
  const depthStatus: ContentStatus = wordCount < 250 ? 'bad' : wordCount < 500 ? 'warn' : 'good';
  const ratioStatus: ContentStatus = textRatio < 10 ? 'warn' : 'good';
  const ogStatus: ContentStatus = ogCount >= 3 ? 'good' : ogCount >= 1 ? 'warn' : 'bad';
  const headingStatus: ContentStatus = headings.jumps === 0 ? 'good' : headings.jumps <= 2 ? 'warn' : 'bad';
  const imageStatus: ContentStatus = imgs.total === 0 ? 'good' : imgs.withoutAlt === 0 ? 'good' : (imgs.withoutAlt / imgs.total) > 0.5 ? 'bad' : 'warn';
  const linkStatus: ContentStatus = links.internal >= 5 ? 'good' : links.internal >= 1 ? 'warn' : 'bad';
  const robotsStatus: ContentStatus = noindex ? 'bad' : 'good';
  const qaStatus: ContentStatus = qa >= 3 ? 'good' : qa >= 1 ? 'warn' : 'bad';
  const napStatus: ContentStatus = nap ? 'good' : 'warn';
  const langStatus: ContentStatus = lang ? 'good' : 'warn';

  return {
    title, titleLength, description, descriptionLength, h1Count, wordCount, textRatio,
    openGraph: og,
    headingLevels: headings.levels,
    headingJumps: headings.jumps,
    imagesTotal: imgs.total,
    imagesWithAlt: imgs.withAlt,
    imagesWithoutAlt: imgs.withoutAlt,
    internalLinks: links.internal,
    externalLinks: links.external,
    metaRobotsNoindex: noindex,
    qaBlocks: qa,
    hasNap: nap,
    htmlLang: lang,
    statuses: {
      title: titleStatus, description: descStatus, h1: h1Status, depth: depthStatus, ratio: ratioStatus,
      openGraph: ogStatus, headings: headingStatus, images: imageStatus, links: linkStatus,
      robots: robotsStatus, qa: qaStatus, nap: napStatus, lang: langStatus
    }
  };
}

// Penalty per severity — the issues list is the single source of truth for BOTH the report and the
// score, so they can never drift.
const PENALTY: Record<GeoSeverity, number> = { high: 25, medium: 12, low: 5 };

// The crawlers that feed the major generative engines. Blocking any of these = invisible to that
// engine's training/retrieval. Names are matched case-insensitively against robots.txt User-agent.
export const AI_CRAWLERS = [
  'GPTBot',           // OpenAI training
  'OAI-SearchBot',    // ChatGPT search
  'ChatGPT-User',     // ChatGPT live browsing
  'ClaudeBot',        // Anthropic
  'anthropic-ai',     // Anthropic (legacy)
  'PerplexityBot',    // Perplexity index
  'Google-Extended',  // Gemini / AI Overviews training
  'CCBot',            // Common Crawl (feeds many models)
  'Applebot-Extended' // Apple Intelligence
];

// ── llms.txt ────────────────────────────────────────────────────────────────────────────────────

// Present AND actually an llms.txt (markdown), not a soft-404 SPA shell served for every path.
export function isLlmsTxt(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  if (/^\s*<(!doctype|html|head|body)\b/i.test(t)) return false; // HTML soft-404
  // llms.txt spec: markdown — a top H1 and/or link list. Be lenient: a markdown heading or link.
  return /^#\s+\S/m.test(t) || /\[[^\]]+\]\([^)]+\)/.test(t);
}

// ── robots.txt ───────────────────────────────────────────────────────────────────────────────────

type RobotsGroup = { agents: string[]; disallowAll: boolean; allowRoot: boolean };

// Parse robots.txt into User-agent groups. ponytail: enough to answer "is bot X blocked from /" —
// not a full RFC 9309 path matcher. Upgrade to per-path matching only if a real case needs it.
export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const field = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      // Consecutive User-agent lines share the following rules (one group).
      if (!cur || !lastWasAgent) { cur = { agents: [], disallowAll: false, allowRoot: false }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === 'disallow' && (value === '/' || value === '')) {
      // Disallow: / blocks everything. Disallow: (empty) means allow-all — record as not-blocking.
      if (value === '/') cur.disallowAll = true;
    } else if (field === 'allow' && value === '/') {
      cur.allowRoot = true;
    }
  }
  return groups;
}

// For each AI crawler, is it blocked from the site root? Most specific matching group wins (exact
// agent name over '*'); an explicit Allow: / overrides a Disallow: / in the same group.
export function aiCrawlerStatus(txt: string): Array<{ bot: string; blocked: boolean }> {
  const groups = parseRobots(txt);
  return AI_CRAWLERS.map((bot) => {
    const lower = bot.toLowerCase();
    const specific = groups.find((g) => g.agents.includes(lower));
    const wildcard = groups.find((g) => g.agents.includes('*'));
    const g = specific ?? wildcard;
    const blocked = !!g && g.disallowAll && !g.allowRoot;
    return { bot, blocked };
  });
}

// ── JSON-LD structured data ───────────────────────────────────────────────────────────────────────

// Collect the schema.org @type values declared in <script type="application/ld+json"> blocks.
// Tolerant: skips blocks that don't parse, unwraps @graph, handles @type as string or array.
export function structuredDataTypes(html: string): string[] {
  const types = new Set<string>();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const collect = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    const t = rec['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
    if (Array.isArray(rec['@graph'])) (rec['@graph'] as unknown[]).forEach(collect);
  };
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) parsed.forEach(collect);
      else collect(parsed);
    } catch { /* skip malformed block */ }
  }
  return [...types];
}

// The JSON-LD NODES, not just their @type values. Same traversal as `structuredDataTypes` (arrays
// and @graph unwrapped, malformed blocks skipped) but the objects survive, so a caller can inspect
// PROPERTIES — which is what any question about prices, availability or ratings actually needs.
export function structuredDataNodes(html: string): AnyRec[] {
  const nodes: AnyRec[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const collect = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const rec = node as AnyRec;
    nodes.push(rec);
    if (Array.isArray(rec['@graph'])) (rec['@graph'] as unknown[]).forEach(collect);
  };
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) parsed.forEach(collect);
      else collect(parsed);
    } catch { /* skip malformed block */ }
  }
  return nodes;
}

// ── commerce readiness: can an assistant COMPARE and ACT on this catalogue? ──────────────────────
//
// The audit used to treat "no Product/Offer markup" as one low-severity nit alongside Article and
// HowTo. For a shop that is wrong by an order of magnitude: Product + Offer is the layer an
// assistant reads to rank items and hand a buyer off, so missing price or availability is the
// difference between being described and being recommended. Severity therefore has to depend on
// what the site IS, and this read is what decides that.
//
// Detection is deliberately conservative, because the cost of a false positive is telling a SaaS
// company it has a broken shop. A `Product` node ALONE does not make a site a shop — plenty of
// software homepages carry one — so it is a weak signal that needs a second one. A published
// `Offer`, an og:type of product, or a storefront platform are each strong enough on their own.

/** Offer fields an assistant ranks and filters on. Absent = the item loses to a complete listing. */
export const OFFER_CORE_FIELDS = ['price', 'priceCurrency', 'availability'] as const;
/** Fields an agent needs to ACT rather than merely quote: a stable identifier and a deep link. */
export const OFFER_ACTION_FIELDS = ['identifier', 'url'] as const;

export type CommerceRead = {
  isCommerce: boolean;
  /** Which signals fired — quoted back to the user so the verdict is never a black box. */
  signals: string[];
  hasProduct: boolean;
  hasOffer: boolean;
  hasAggregateRating: boolean;
  missingCoreFields: string[];
  missingActionFields: string[];
};

const IDENTIFIER_FIELDS = ['sku', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'mpn', 'productID'];

// Storefront fingerprints that survive theming — CDN hosts and plugin paths, not marketing copy.
const ECOMMERCE_PLATFORM = /cdn\.shopify(cloud)?\.com|shopifycdn|Shopify\.theme|woocommerce|wp-content\/plugins\/woocommerce|bigcommerce|\/Magento_|prestashop|squarespace-commerce|snipcart/i;
const CART_LINK = /href=["'][^"']*\/(cart|carrello|panier|carrito|checkout|basket)\b/i;
const ADD_TO_CART = /add to (cart|basket)|aggiungi al carrello|ajouter au panier|a[ñn]adir al carrito|agregar al carrito|buy now|acquista ora|comprar ahora|acheter maintenant/i;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);
const typesOf = (node: AnyRec): string[] => {
  const t = node['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
};
const isType = (node: AnyRec, re: RegExp) => typesOf(node).some((t) => re.test(t));
const hasValue = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(hasValue);
  return true;
};

// og:type lives in one <meta> whose attribute order varies between generators — match the tag, then
// look inside it, rather than betting on property-before-content.
function ogTypeIsProduct(html: string): boolean {
  const tag = html.match(/<meta[^>]+property=["']og:type["'][^>]*>/i)?.[0];
  return !!tag && /content=["'][^"']*product/i.test(tag);
}

export function commerceReadiness(html: string): CommerceRead {
  const nodes = structuredDataNodes(html);
  const productNodes = nodes.filter((n) => isType(n, /^(Product|ProductGroup|IndividualProduct|ProductModel)$/i));
  const offerNodes: AnyRec[] = [
    ...nodes.filter((n) => isType(n, /^(Offer|AggregateOffer)$/i)),
    ...productNodes.flatMap((p) => (Array.isArray(p.offers) ? p.offers.filter(isRec) : isRec(p.offers) ? [p.offers] : []))
  ];

  const hasProduct = productNodes.length > 0;
  const hasOffer = offerNodes.length > 0;
  const hasAggregateRating =
    nodes.some((n) => isRec(n.aggregateRating) || isType(n, /^(AggregateRating|Review)$/i)) ||
    productNodes.some((p) => hasValue(p.review));

  // A field counts as present when ANY offer declares it — one complete listing proves the site
  // knows how, and the fix is then a rollout rather than a design decision.
  const onOffers = (field: string) => offerNodes.some((o) => hasValue(o[field]));
  const onProducts = (field: string) => productNodes.some((p) => hasValue(p[field]));

  const missingCoreFields = OFFER_CORE_FIELDS.filter((f) =>
    // AggregateOffer states a range instead of a single price; either satisfies "we published a price".
    f === 'price' ? !(onOffers('price') || onOffers('lowPrice')) : !onOffers(f)
  );
  const missingActionFields = OFFER_ACTION_FIELDS.filter((f) =>
    f === 'identifier'
      ? !IDENTIFIER_FIELDS.some((k) => onOffers(k) || onProducts(k))
      : !(onOffers('url') || onProducts('url'))
  );

  const strong: string[] = [];
  if (hasOffer) strong.push('offer-schema');
  if (ogTypeIsProduct(html)) strong.push('og-type-product');
  if (ECOMMERCE_PLATFORM.test(html)) strong.push('ecommerce-platform');
  const weak: string[] = [];
  if (hasProduct) weak.push('product-schema');
  if (CART_LINK.test(html)) weak.push('cart-link');
  if (ADD_TO_CART.test(html)) weak.push('add-to-cart-copy');

  return {
    isCommerce: strong.length > 0 || weak.length >= 2,
    signals: [...strong, ...weak],
    hasProduct,
    hasOffer,
    hasAggregateRating,
    missingCoreFields: [...missingCoreFields],
    missingActionFields: [...missingActionFields]
  };
}

// ── sitemap + meta ────────────────────────────────────────────────────────────────────────────────

export function sitemapUrlCount(xml: string): number {
  if (/^\s*<(!doctype|html)\b/i.test(xml.trim())) return 0; // soft-404
  return (xml.match(/<loc>/gi) ?? []).length;
}

export function metaBasics(html: string): GeoTechAudit['meta'] {
  return {
    title: /<title[^>]*>\s*[^<\s]/i.test(html),
    description: /<meta[^>]+name=["']description["'][^>]+content=["']\s*[^"'\s<]/i.test(html),
    canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
    ogTitle: /<meta[^>]+property=["']og:title["']/i.test(html)
  };
}

// Fallback used when analyzeContent throws — keeps the audit working without content data.
const EMPTY_CONTENT: GeoContentAnalysis = {
  title: null, titleLength: 0, description: null, descriptionLength: 0,
  h1Count: 0, wordCount: 0, textRatio: 0,
  openGraph: { image: false, description: false, type: false, url: false },
  headingLevels: [], headingJumps: 0, imagesTotal: 0, imagesWithAlt: 0, imagesWithoutAlt: 0,
  internalLinks: 0, externalLinks: 0, metaRobotsNoindex: false, qaBlocks: 0, hasNap: false, htmlLang: null,
  statuses: {
    title: 'bad', description: 'bad', h1: 'warn', depth: 'bad', ratio: 'bad',
    openGraph: 'bad', headings: 'warn', images: 'warn', links: 'warn',
    robots: 'good', qa: 'bad', nap: 'warn', lang: 'warn'
  }
};

// ── compose the audit from the fetched inputs (PURE — testable) ─────────────────────────────────

export function buildTechAudit(inputs: {
  llmsTxtBody: string;
  robotsTxt: string;
  homepageHtml: string;
  sitemapXml: string;
}): GeoTechAudit {
  const llmsTxt = isLlmsTxt(inputs.llmsTxtBody);
  const aiCrawlers = aiCrawlerStatus(inputs.robotsTxt);
  const sdTypes = structuredDataTypes(inputs.homepageHtml);
  const sitemapUrls = sitemapUrlCount(inputs.sitemapXml);
  const meta = metaBasics(inputs.homepageHtml);
  // Defensive: content analysis must never break the whole tech audit (which would zero out the
  // score). If parsing fails for any reason, skip content and continue with the rest.
  let content: GeoContentAnalysis | null = null;
  try { content = analyzeContent(inputs.homepageHtml); } catch (e) {
    console.error('[geo] analyzeContent failed:', e instanceof Error ? e.message : e);
  }

  const issues: GeoIssue[] = [];

  const blocked = aiCrawlers.filter((c) => c.blocked).map((c) => c.bot);
  if (blocked.length) {
    issues.push({
      id: 'ai-crawlers-blocked', severity: 'high',
      title: `${blocked.length} AI crawler${blocked.length > 1 ? 's' : ''} blocked in robots.txt`,
      detail: `robots.txt disallows: ${blocked.join(', ')}. These engines cannot read the site.`,
      fix: 'Remove the Disallow rules for these user-agents (or scope them narrowly) so generative engines can index the brand.'
    });
  }

  const hasOrg = sdTypes.some((t) => /Organization|LocalBusiness|Brand/i.test(t));
  if (!hasOrg) {
    issues.push({
      id: 'no-org-schema', severity: 'medium',
      title: 'No Organization structured data',
      detail: 'The homepage has no JSON-LD Organization/Brand block, so LLMs cannot reliably attribute facts to the brand.',
      fix: 'Add a schema.org Organization JSON-LD block (name, url, logo, sameAs) to the homepage.'
    });
  }
  const hasFaq = sdTypes.some((t) => /FAQPage|QAPage/i.test(t));
  if (!hasFaq) {
    issues.push({
      id: 'no-faq-schema', severity: 'medium',
      title: 'No FAQ structured data',
      detail: 'FAQPage markup is among the most-cited formats in AI answers; the site exposes none.',
      fix: 'Publish a FAQ section with schema.org FAQPage markup answering the questions the audience actually asks.'
    });
  }

  if (!llmsTxt) {
    issues.push({
      id: 'no-llms-txt', severity: 'low',
      title: 'No /llms.txt',
      detail: 'The emerging llms.txt standard gives generative engines a curated map of the most important pages. Absent.',
      fix: 'Publish /llms.txt (markdown) linking the key pages LLMs should read: product, about, docs, FAQ.'
    });
  }
  if (sitemapUrls === 0) {
    issues.push({
      id: 'no-sitemap', severity: 'low',
      title: 'No sitemap.xml',
      detail: 'No discoverable sitemap.xml — crawlers must guess the site structure.',
      fix: 'Generate a sitemap.xml and reference it from robots.txt.'
    });
  }
  const missingMeta = Object.entries(meta).filter(([, v]) => !v).map(([k]) => k);
  if (missingMeta.length) {
    issues.push({
      id: 'weak-meta', severity: 'low',
      title: 'Incomplete homepage meta',
      detail: `Missing: ${missingMeta.join(', ')}.`,
      fix: 'Add a descriptive <title>, meta description, canonical link and og:title to the homepage.'
    });
  }

  // Content quality issues (title too short, thin content, AI-unreadable) — these hurt both classic
  // SEO ranking and whether generative engines can understand + cite the page. Skip if content
  // analysis failed.
  if (content && content.title && content.titleLength < 30) {
    issues.push({
      id: 'weak-title', severity: 'low',
      title: 'Homepage title too short',
      detail: `"${content.title.slice(0, 60)}" is only ${content.titleLength} characters — too vague for search engines and LLMs.`,
      fix: 'Write a descriptive title of 50–60 characters that names the brand and what it offers.'
    });
  }
  if (content && content.wordCount < 250) {
    issues.push({
      id: 'thin-content', severity: 'medium',
      title: 'Thin homepage content',
      detail: `Only ${content.wordCount} words of readable text. Generative engines need substantial text to understand and cite a page.`,
      fix: 'Add 300+ words of descriptive body copy explaining what the brand does, for whom, and why it matters.'
    });
  }
  if (content && content.textRatio < 10 && inputs.homepageHtml.length > 1000) {
    issues.push({
      id: 'low-text-ratio', severity: 'low',
      title: 'Low text-to-HTML ratio',
      detail: `Only ${content.textRatio}% of the page is readable text — likely a JS-rendered SPA. Crawlers that don't execute JS see a near-empty page.`,
      fix: 'Server-side render key content (HTML) rather than injecting it with JavaScript.'
    });
  }

  // Extended checks
  if (content && content.metaRobotsNoindex) {
    issues.push({
      id: 'noindex-active', severity: 'high',
      title: 'Homepage is noindex',
      detail: 'A <meta name="robots" content="noindex"> tag tells every search engine and AI crawler to ignore this page entirely.',
      fix: 'Remove the noindex directive from the homepage meta robots tag.'
    });
  }

  // Structured data for what the page actually IS. The severity is NOT fixed: on a shop, a missing
  // Product/Offer layer is why an assistant can describe the brand and still be unable to rank or
  // recommend a single item, so commerce sites are graded on their offer completeness instead of on
  // the generic "some content schema exists" check that everyone else gets.
  const commerce = commerceReadiness(inputs.homepageHtml);
  const hasContentSchema = sdTypes.some((t) => /Product|Service|Article|Review|HowTo|BreadcrumbList|Event|Course|Recipe|VideoObject/i.test(t));
  if (commerce.isCommerce) {
    if (!commerce.hasProduct) {
      issues.push({
        id: 'no-product-schema', severity: 'high',
        title: 'Sells, but publishes no Product structured data',
        detail: `The site sells (signals: ${commerce.signals.join(', ')}) yet exposes no schema.org Product block. Assistants can read what the brand is and still be unable to compare or recommend anything it stocks.`,
        fix: 'Add schema.org Product markup to every product page — name, description, image, brand — with a nested offers object.'
      });
    } else if (!commerce.hasOffer) {
      issues.push({
        id: 'no-offer-schema', severity: 'medium',
        title: 'Product markup with no Offer',
        detail: 'Product blocks exist but none carries an offers object, so price and availability are invisible to anything reading the page as data.',
        fix: 'Nest an Offer inside each Product: price, priceCurrency, availability and the canonical product url.'
      });
    } else if (commerce.missingCoreFields.length) {
      issues.push({
        id: 'incomplete-offer-schema', severity: 'medium',
        title: 'Offer missing the fields assistants rank on',
        detail: `The published Offer omits: ${commerce.missingCoreFields.join(', ')}. Filtering and ranking happen on exactly these fields, so an incomplete listing loses to a complete competitor.`,
        fix: 'Populate price, priceCurrency and availability (schema.org/InStock and friends) on every Offer, and keep them in sync with what the page shows.'
      });
    } else if (commerce.missingActionFields.length) {
      issues.push({
        id: 'unactionable-offer-schema', severity: 'low',
        title: 'Offer an agent cannot act on',
        detail: `Price and availability are there, but the Offer has no ${commerce.missingActionFields.join(' or ')}. Without a stable identifier and a deep link an agent can quote the product and not send a buyer to it.`,
        fix: 'Add a sku/gtin/mpn identifier and the canonical product url to each Offer.'
      });
    }
    if (!commerce.hasAggregateRating) {
      issues.push({
        id: 'no-review-schema', severity: 'low',
        title: 'No review or rating structured data',
        detail: 'No aggregateRating or Review markup anywhere. Verified review volume and sentiment are among the trust signals generative engines weigh before naming a product.',
        fix: 'Expose real verified reviews with schema.org Review/aggregateRating on product pages — never synthesised ratings.'
      });
    }
  } else if (!hasContentSchema) {
    issues.push({
      id: 'no-content-schema', severity: 'low',
      title: 'No content-type structured data',
      detail: 'Beyond Organization/FAQ, the homepage has no Product, Service, Article, Review or HowTo schema — the types AI engines extract most.',
      fix: 'Add schema.org markup for the specific content type (Product, Service, Article, Review, HowTo) that matches what the page offers.'
    });
  }

  if (content && content.imagesTotal > 3 && content.imagesWithoutAlt / content.imagesTotal > 0.5) {
    issues.push({
      id: 'images-no-alt', severity: 'low',
      title: 'Images missing alt text',
      detail: `${content.imagesWithoutAlt} of ${content.imagesTotal} images have no alt text. AI engines cannot "see" images — alt is the only bridge.`,
      fix: 'Add descriptive alt attributes to all meaningful images (decorative ones can use alt="").'
    });
  }

  const score = Math.max(0, 100 - issues.reduce((s, i) => s + PENALTY[i.severity], 0));
  return { score, llmsTxt, aiCrawlers, structuredDataTypes: sdTypes, commerce, sitemapUrls, meta, content: content ?? EMPTY_CONTENT, responseMs: null, issues };
}

// ── orchestrator: fetch the well-known URLs and compose (best-effort, SSRF-safe) ────────────────

export async function auditSiteTech(url: string): Promise<GeoTechAudit | null> {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return null; }
  const t0 = Date.now();
  const [homepageHtml, llmsTxtBody, robotsTxt, sitemapXml] = await Promise.all([
    fetchPage(url).catch((error) => { swallow('fetch page', error); return ''; }),
    fetchPage(`${origin}/llms.txt`).catch(() => ''),
    fetchPage(`${origin}/robots.txt`).catch(() => ''),
    fetchPage(`${origin}/sitemap.xml`).catch(() => '')
  ]);
  const responseMs = Date.now() - t0;
  if (!homepageHtml && !robotsTxt) return null; // site unreachable → no audit, not a zero score
  const audit = buildTechAudit({ llmsTxtBody, robotsTxt, homepageHtml, sitemapXml });
  audit.responseMs = responseMs;
  // The homepage HTML rides back out so the citability levers can read it without a second fetch.
  // It is NOT persisted — `geoTickForBrandInner` uses it and drops it before the insert.
  audit.homepageHtml = homepageHtml;
  return audit;
}

// ── Level 2: citation share-of-voice (reuses research.ts grounding spine) ────────────────────────
//
// When a real buyer asks an LLM a category question, does THIS brand get named? We seed those
// questions from the profile, ask each against a web-grounded model, and extract whether the brand
// appears, where, and which competitors got named instead. Same GROUNDED→STRUCTURED pair research.ts
// established (grounding + JSON mode can't share one call).
//
// Engines: Gemini (Google grounding), Exa (/answer), plus GPT / Grok / Claude via kie.ai when
// KIE_API_KEY is set — cheapest tiers only (gpt-5-6-luna, grok-4-3, claude-haiku-4-5).

export type GeoEngine = 'gemini' | 'gpt' | 'grok' | 'claude' | 'perplexity' | 'exa';

export type CitationResult = {
  engine: GeoEngine;     // which answer engine produced this verdict
  prompt: string;
  brandMentioned: boolean;
  rank: number | null;   // 1-based position among the brands named in the answer; null if absent
  competitors: string[]; // other brands the answer recommended
  sources: string[];     // domains the grounded answer cited
  /** Set when the probe failed (network/API) — not a genuine “not mentioned”. */
  error?: string | null;
};

const GEO_PROMPTS_SCHEMA = {
  type: 'object' as const,
  properties: {
    prompts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          prompt: { type: 'string' as const, description: 'A natural category question a buyer would type into ChatGPT/Perplexity — NOT the brand name.' },
          lang: { type: 'string' as const, enum: ['it', 'en'] as const }
        },
        required: ['prompt', 'lang']
      },
      description: "5-7 questions where THIS brand SHOULD appear in a good answer: best-in-category, 'alternatives to', how-to-choose, and problem-first phrasings."
    }
  },
  required: ['prompts']
};

// Seed the category questions from the brand profile. Idempotent (unique constraint absorbs re-runs).
export async function seedGeoPrompts(
  admin: SupabaseClient,
  brandId: string,
  profile: AnyRec,
  outputLanguage = 'Italian'
): Promise<number> {
  const ai = genaiClient();
  const prompt = `Generate the questions a potential customer would type into ChatGPT or Perplexity when looking for a solution like this brand — the questions where this brand DESERVES to be named in a good answer.

Brand: ${profile?.name ?? ''}
About: ${String(profile?.about ?? '').slice(0, 400)}
Category: ${profile?.category ?? ''}
Audience: ${profile?.target_audience ?? ''}
Market/language: ${outputLanguage}

Write questions the way a real person phrases them (never the bare brand name). Mix: "best X for Y", "alternatives to <a well-known competitor>", "how do I choose an X", and a problem-first phrasing. Keep them in ${outputLanguage} unless the category is inherently English.`;
  const out = await structured<{ prompts?: Array<{ prompt: string; lang: string }> }>(
    ai, prompt, GEO_PROMPTS_SCHEMA,
    'You are a GEO analyst modelling how buyers query generative engines.'
  );
  const rows: AnyRec[] = [];
  for (const p of (out.prompts ?? []).slice(0, 7)) {
    // Il modello è vincolato a it|en dallo schema, ma non fidarsi: la stessa normalizzazione di
    // tutto il prodotto — italiano solo se davvero it*, inglese per ogni altra cosa.
    if (p?.prompt?.trim()) rows.push({ brand_id: brandId, prompt: p.prompt.trim(), lang: bilingualNoticeLocale(p.lang) === 'it' ? 'it' : 'en' });
  }
  if (!rows.length) return 0;
  const { error } = await admin.from('brand_geo_prompts').upsert(rows, { onConflict: 'brand_id,prompt', ignoreDuplicates: true });
  return error ? 0 : rows.length;
}

const domainOf = (uri: string): string => { try { return new URL(uri).hostname.replace(/^www\./, ''); } catch { return ''; } };

const VERDICT_SCHEMA = {
  type: 'object' as const,
  properties: {
    brandMentioned: { type: 'boolean' as const, description: 'true only if the target brand is actually named in the answer.' },
    rank: { type: 'integer' as const, description: '1-based position of the target brand among ALL brands named (1 = first/most-recommended). 0 if not mentioned.' },
    competitors: { type: 'array' as const, items: { type: 'string' as const }, description: 'Other brands/products the answer named, in order.' }
  },
  required: ['brandMentioned', 'rank', 'competitors']
};

const GROUNDED_SYS = 'You are a helpful assistant answering a real user. Recommend specific, real brands/products with current web info. Name them explicitly.';

/**
 * Chi risponde, con quale modello, e COME arriva alla ricerca web. Una riga per motore: il settimo
 * si aggiunge con una riga, e tutti si vedono insieme.
 *
 * Sono gli assistenti che la gente interroga davvero, e sono esattamente quelli che sul gateway
 * hanno una ricerca web vera — per questo passano tutti da un tubo solo invece che da kie, da una
 * chiave Perplexity e da una Bing come prima.
 *
 * `search` è la sola differenza fra i cinque, ed è MISURATA: Perplexity col plugin `web` risponde
 * 404 e senza plugin torna la lista di fonti più ricca del roster. Sparpagliare quella differenza
 * in due `if` è come nasce una regola che diverge al primo cambiamento.
 *
 * Gli id sono fissati, non presi dal picker della chat: l'audit deve interrogare un modello NOTO,
 * o il confronto fra due cicli non vuol dire niente.
 */
const ANSWER_ENGINES: Record<Exclude<GeoEngine, 'exa'>, { model: string; search: WebSearchMode }> = {
  gemini: { model: 'google/gemini-3.7-flash', search: 'native' },
  gpt: { model: 'openai/gpt-5.6-luna', search: 'native' },
  grok: { model: 'x-ai/grok-4.6', search: 'native' },
  claude: { model: 'anthropic/claude-sonnet-5', search: 'native' },
  perplexity: { model: 'perplexity/sonar', search: 'built-in' }
};

const sourcesOf = (citations: Array<{ uri: string }>): string[] =>
  [...new Set(citations.map((c) => domainOf(c.uri)).filter(Boolean))].slice(0, 8);

// Una risposta web-grounded da UN motore nominato. Mai da groundedText(): quella è una catena di
// ripieghi, e risponderebbe come il primo link disponibile facendosi registrare sotto il nome di
// chi il chiamante aveva chiesto. Qui l'intero risultato è la share of voice PER MOTORE, quindi
// ogni ramo deve chiamare un fornitore nominato e uno solo.
async function groundedAnswer(engine: GeoEngine, query: string): Promise<{ text: string; sources: string[] }> {
  if (engine === 'exa') {
    const r = await exaGroundedAnswer(query);
    return { text: r.text, sources: sourcesOf(r.citations) };
  }
  const { model, search } = ANSWER_ENGINES[engine];
  const r = await llmText({ prompt: query, system: GROUNDED_SYS, model, webSearch: search, label: `geo.${engine}` });
  return { text: r.text, sources: sourcesOf(r.citations) };
}

// Ask one category question against one engine, then extract the verdict (verdict step just parses
// the answer text). Best-effort.
async function auditOnePrompt(engine: GeoEngine, brandName: string, p: { prompt: string; lang?: string | null }): Promise<CitationResult> {
  const empty: CitationResult = { engine, prompt: p.prompt, brandMentioned: false, rank: null, competitors: [], sources: [], error: null };
  try {
    const { text, sources } = await groundedAnswer(engine, p.prompt);
    if (!text) return { ...empty, error: 'empty_answer' };
    const v = await structured<{ brandMentioned?: boolean; rank?: number; competitors?: string[] }>(
      genaiClient(),
      `The brand we care about is "${brandName}". From the answer below, determine whether "${brandName}" is named, its 1-based rank among all brands named (0 if absent), and list the OTHER brands named.\n\nANSWER:\n${text}`,
      VERDICT_SCHEMA
    );
    const rank = Number(v?.rank) || 0;
    return {
      engine, prompt: p.prompt,
      brandMentioned: v?.brandMentioned === true && rank > 0,
      rank: rank > 0 ? rank : null,
      competitors: (Array.isArray(v?.competitors) ? v.competitors : []).map((c) => String(c).trim()).filter(Boolean).slice(0, 8),
      sources,
      error: null
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message.slice(0, 180) : 'probe_failed' };
  }
}

export type CitationAudit = {
  shareOfVoice: number;
  results: CitationResult[];
  perEngine: Record<string, number>;
  /**
   * Share of answers that cited the brand's OWN DOMAIN as a source. A different event from being
   * named, and rarer: a brand can be mentioned in every answer and linked in none. The two have
   * different fixes — being named is won on third-party sources, being cited on the page itself —
   * so collapsing them into one number hid the only actionable half.
   */
  domainCitedShare: number;
  /** How many times each prompt was asked. Citation is non-deterministic; one observation is noise. */
  samplesPerPrompt: number;
};

/**
 * I motori di questo giro. I cinque del gateway non si accendono uno alla volta: hanno UNA chiave
 * sola, e una sonda che fallisce esce già dal conteggio come errore invece di valere «non citato».
 * Exa ha una chiave sua, quindi resta condizionata.
 */
export function citationEngines(): GeoEngine[] {
  const engines = Object.keys(ANSWER_ENGINES) as GeoEngine[];
  if (exaConfigured()) engines.push('exa');
  return engines;
}

/** Engines that run live answer probes this deploy (vs robots.txt crawl checks only). */
export function measuredCitationEngines(): GeoEngine[] {
  return citationEngines();
}

// Run every prompt against every ENABLED engine in parallel. shareOfVoice = % of (engine × prompt)
// answers that named the brand; perEngine breaks it down so the UI can show where the brand is
// winning/losing citations.
export async function runCitationAudit(
  brandName: string,
  prompts: Array<{ prompt: string; lang?: string | null }>,
  opts: { samplesPerPrompt?: number; brandDomain?: string | null } = {}
): Promise<CitationAudit> {
  if (!prompts.length) return { shareOfVoice: 0, results: [], perEngine: {}, domainCitedShare: 0, samplesPerPrompt: 0 };
  const samplesPerPrompt = Math.max(1, Math.min(5, opts.samplesPerPrompt ?? CITATION_SAMPLES));
  const engines = citationEngines();
  const tasks: Array<Promise<CitationResult>> = [];
  // Ask each question MORE THAN ONCE. Citation is non-deterministic — the same query returns
  // different sources across sessions and regions — so a single observation is noise, not a
  // measurement, and a share-of-voice built on n=1 per question moved every week for no reason.
  for (const engine of engines) {
    for (const p of prompts) {
      for (let i = 0; i < samplesPerPrompt; i++) tasks.push(auditOnePrompt(engine, brandName, p));
    }
  }
  const results = await Promise.all(tasks);
  // Le percentuali si calcolano solo sulle risposte che ci sono STATE. Una sonda fallita (chiave
  // morta, 429, timeout, risposta vuota) non è la prova che il brand non sia citato: contarla come
  // non-menzione trasformava il guasto di un provider in un voto più basso per il brand, senza che
  // nessuno avesse mai raggiunto quel motore. Meglio un motore in meno che un motore inventato.
  //
  // Da non confondere con una risposta SENZA FONTI, che è un'altra cosa e resta nel conteggio:
  // OpenAI cita qualcosa in circa una risposta su tre, e quelle senza citazioni sono risposte
  // valide di cui si legge il testo — valgono zero solo sul dominio citato.
  const answered = results.filter((r) => !r.error);
  const share = (n: number, total: number): number => (total ? Math.round((n / total) * 100) : 0);
  const perEngine: Record<string, number> = {};
  for (const engine of engines) {
    const er = answered.filter((r) => r.engine === engine);
    perEngine[engine] = share(er.filter((r) => r.brandMentioned).length, er.length);
  }
  const ownDomain = normalizeDomain(opts.brandDomain);
  const domainCited = ownDomain
    ? answered.filter((r) => r.sources.some((src) => domainMatches(src, ownDomain))).length
    : 0;
  return {
    shareOfVoice: share(answered.filter((r) => r.brandMentioned).length, answered.length),
    results,
    perEngine,
    domainCitedShare: ownDomain ? share(domainCited, answered.length) : 0,
    samplesPerPrompt
  };
}

/**
 * How many times each question is asked per engine. Three is the floor at which a share stops being
 * an anecdote; five would be better and costs 66% more per run, which at fleet scale is the whole
 * budget. `GEO_CITATION_SAMPLES` overrides it per deploy.
 */
export const CITATION_SAMPLES = Math.max(1, Math.min(5, Number(env.GEO_CITATION_SAMPLES ?? 3)));

/** Bare host, lowercased, without `www.` — comparable across the shapes the engines return. */
export function normalizeDomain(input: string | null | undefined): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/^www\./i, '').toLowerCase() || null;
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase() || null;
  }
}

/** A subdomain counts as the brand's own domain; a different registrable domain does not. */
export function domainMatches(candidate: string, own: string): boolean {
  const c = normalizeDomain(candidate);
  return !!c && (c === own || c.endsWith(`.${own}`));
}

// ── Orchestrator: one brand's full GEO pass → persisted snapshot ─────────────────────────────────

// Per-keyword AI Overview presence + whether the brand's own domain is among the cited sources.
// "We rank #3" and "we're in the answer above the results" are different facts, and only the
// second one survives a searcher who never scrolls.
export type AiOverviewRow = { keyword: string; hasAiOverview: boolean; cited: boolean; position: number | null; sources: string[] };
export type AiOverviewSnapshot = { checked: number; withOverview: number; cited: number; rows: AiOverviewRow[] };

export type GeoSnapshot = {
  techScore: number | null;
  shareOfVoice: number;
  /**
   * Share of answers that cited the brand's own DOMAIN. Being named and being linked are different
   * events with different fixes, so they are two numbers, not one.
   */
  domainCitedShare: number;
  /**
   * 0-100 across the five weighted levers, or `null` when coverage was too thin to grade. This is
   * the number that answers "will a model cite us"; `techScore` answers the narrower "can a crawler
   * reach us", and is 10% of this one.
   */
  citabilityScore: number | null;
  /** The lever actually limiting citation — fixing the others moves nothing until it is addressed. */
  bindingConstraint: string | null;
  issues: GeoIssue[];
  citations: CitationResult[];
  search: SearchPerformance | null;
  backlinks: BacklinkSummary | null;
  aiOverview: AiOverviewSnapshot | null;
};

// Keywords sampled for the AI Overview check each week. Each one is a live SERP task, so this is
// the cost knob for the whole panel — prefer tracked keywords when present (up to 10).
const AI_OVERVIEW_KEYWORDS = 10;

/**
 * Sample the brand's best-ranking keywords and record, for each, whether Google shows an AI
 * Overview and whether the brand is cited in it. Runs after the search panel because it needs
 * the ranked keywords that panel returns.
 */
async function auditAiOverview(url: string, search: SearchPerformance | null, language: string, trackedKeywords: string[] = []): Promise<AiOverviewSnapshot | null> {
  const fromTracked = trackedKeywords.filter(Boolean).slice(0, AI_OVERVIEW_KEYWORDS);
  const fromSearch = (search?.topKeywords ?? []).map((k) => k.keyword).filter(Boolean);
  const keywords = [...new Set([...fromTracked, ...fromSearch])].slice(0, AI_OVERVIEW_KEYWORDS);
  if (!keywords.length) return null;

  const domain = search?.domain ?? '';
  const snapshots = await Promise.all(keywords.map((k) => fetchSerpSnapshot(k, url, language).catch((error) => { swallow('fetch serp snapshot', error); return null; })));
  const rows: AiOverviewRow[] = snapshots.filter(Boolean).map((s) => ({
    keyword: s!.keyword,
    hasAiOverview: s!.hasAiOverview,
    cited: s!.aiOverviewSources.includes(domain),
    position: s!.yourPosition,
    sources: s!.aiOverviewSources.slice(0, 8)
  }));
  if (!rows.length) return null;

  return {
    checked: rows.length,
    withOverview: rows.filter((r) => r.hasAiOverview).length,
    cited: rows.filter((r) => r.cited).length,
    rows
  };
}

// Resolve the site URL, run tech + citation audits, persist ONE snapshot row. Best-effort: a failing
// half still stores what it has. Seeds the category prompts on first run. Never throws.
// Credits: called from cron/scheduler outside any request scope — set the brand context here.
export async function geoTickForBrand(admin: SupabaseClient, brand: AnyRec): Promise<GeoSnapshot | null> {
  return withBrandContext(String(brand.id), () => geoTickForBrandInner(admin, brand));
}

async function geoTickForBrandInner(admin: SupabaseClient, brand: AnyRec): Promise<GeoSnapshot | null> {
  try {
    const { data: kit } = await admin
      .from('brand_kit').select('source_url, about, category, target_audience').eq('brand_id', brand.id).maybeSingle();
    const url = String(kit?.source_url || brand.website || '').trim();
    const language = (brand.content_prefs?.language as string) || 'Italian';

    const [tech, searchBase, backlinksBase] = await Promise.all([
      url ? auditSiteTech(url).catch((error) => { swallow('audit site tech', error); return null; }) : Promise.resolve(null),
      url ? fetchSearchPerformance(url, language).catch((error) => { swallow('fetch search performance', error); return null; }) : Promise.resolve(null),
      url ? fetchBacklinkSummary(url).catch((error) => { swallow('fetch backlink summary', error); return null; }) : Promise.resolve(null)
    ]);

    // Histories are slower/pricier (~$0.16 combined) — run in parallel after the live snapshot so
    // a history failure never blanks the current metrics panel.
    const [searchHistory, backlinkHistory] = url
      ? await Promise.all([
          fetchHistoricalRankOverview(url, language, 12).catch((error) => { swallow('fetch rank history', error); return null; }),
          fetchBacklinkHistory(url, 12).catch((error) => { swallow('fetch backlink history', error); return null; })
        ])
      : [null, null];

    const search: SearchPerformance | null = searchBase
      ? { ...searchBase, ...(searchHistory?.length ? { history: searchHistory } : {}) }
      : null;
    const backlinks: BacklinkSummary | null = backlinksBase
      ? { ...backlinksBase, ...(backlinkHistory?.length ? { history: backlinkHistory } : {}) }
      : null;

    // Needs the ranked keywords from `search`, so it can't join the batch above.
    const { data: tracked } = await admin
      .from('brand_tracked_keywords')
      .select('keyword')
      .eq('brand_id', brand.id)
      .eq('active', true)
      .limit(AI_OVERVIEW_KEYWORDS);
    const trackedKws = (tracked ?? []).map((t) => String(t.keyword));
    const aiOverview = url ? await auditAiOverview(url, search, language, trackedKws).catch((error) => { swallow('audit ai overviews', error); return null; }) : null;

    // Prompts: seed on first run from the profile, then load the active set.
    let { data: prompts } = await admin.from('brand_geo_prompts').select('prompt, lang').eq('brand_id', brand.id).eq('active', true);
    if (!prompts?.length) {
      await seedGeoPrompts(admin, String(brand.id), { name: brand.name, ...kit }, language).catch((error) => { swallow('String failed', error); return 0; });
      ({ data: prompts } = await admin.from('brand_geo_prompts').select('prompt, lang').eq('brand_id', brand.id).eq('active', true));
    }
    const citation = await runCitationAudit(String(brand.name ?? ''), prompts ?? [], { brandDomain: url }).catch((error) => { swallow('String failed', error); return ({ shareOfVoice: 0, results: [] as CitationResult[], perEngine: {}, domainCitedShare: 0, samplesPerPrompt: 0 }); });

    if (!tech && !citation.results.length && !search) return null;

    // CITABILITY — the five weighted levers, of which the technical audit is 10%. The old tech
    // score is kept alongside it (it is charted, compared and stored per run), but on its own it
    // answered a much narrower question than the panel implied: a site can score 95 there and never
    // be named in an answer.
    const homepageHtml = tech?.homepageHtml ?? '';
    const probes = citation.results.length;
    const corroboration = probes
      ? corroborationOf({
          probes,
          mentioned: citation.results.filter((r) => r.brandMentioned).length,
          domainCited: Math.round((citation.domainCitedShare / 100) * probes)
        })
      : null;
    const extractability = homepageHtml ? extractabilityOf(homepageHtml) : null;
    const evidence = homepageHtml ? evidenceDensityOf(homepageHtml) : null;
    const entity = homepageHtml ? entityClarityOf(homepageHtml, String(brand.name ?? ''), tech?.structuredDataTypes ?? []) : null;
    const citability = homepageHtml
      ? geoCitability({
          extractability: extractability?.value ?? null,
          evidence: evidence?.value ?? null,
          entity: entity?.value ?? null,
          // Unmeasurable without probes — and reporting a citability score that quietly excluded the
          // most predictive lever would be exactly the silent fill the coverage gate exists to stop.
          corroboration: corroboration?.value ?? null,
          machineAccess: tech ? tech.score / 100 : null,
          notes: {
            extractability: extractability?.note ?? '',
            evidence: evidence?.note ?? '',
            entity: entity?.note ?? '',
            corroboration: corroboration?.note ?? ''
          },
          antiSignals: antiCitationSignalsOf(homepageHtml)
        })
      : null;

    // The HTML was a transport detail for the levers above — it never goes into the snapshot.
    // `citability` rides inside the existing jsonb `tech` column so this lands without a migration;
    // a dedicated column can follow once the shape settles.
    const techForStorage = tech
      ? {
          ...tech,
          homepageHtml: undefined,
          ...(citability
            ? {
                citability: {
                  score: citability.graded.score,
                  coverage: citability.graded.coverage,
                  tier: citability.graded.tier,
                  levers: citability.levers,
                  bindingConstraint: citability.bindingConstraint,
                  antiSignals: citability.antiSignals,
                  priorities: citability.priorities,
                  gaps: citability.gaps,
                  disclaimer: citability.disclaimer,
                  domainCitedShare: citation.domainCitedShare,
                  samplesPerPrompt: citation.samplesPerPrompt
                }
              }
            : {})
        }
      : null;

    const { error: insertErr } = await admin.from('brand_geo_audits').insert({
      brand_id: brand.id,
      tech_score: tech?.score ?? null,
      tech: techForStorage,
      share_of_voice: citation.shareOfVoice,
      citations: citation.results,
      search: search ?? null,
      backlinks: backlinks ?? null,
      ai_overview: aiOverview ?? null
    });
    if (insertErr) throw new Error(`brand_geo_audits insert failed: ${insertErr.message}`);

    // Closed loop: open citation opportunities (reprobe runs on daily /geo/reprobe/tick)
    try {
      const { openGeoOpportunities } = await import('$lib/server/geo-opportunities');
      await openGeoOpportunities(admin, String(brand.id), citation.results);
    } catch (e) {
      console.error('[geo] opportunities', brand?.slug, e instanceof Error ? e.message : e);
    }

    return {
      techScore: tech?.score ?? null,
      shareOfVoice: citation.shareOfVoice,
      domainCitedShare: citation.domainCitedShare,
      citabilityScore: citability?.graded.score ?? null,
      bindingConstraint: citability?.bindingConstraint?.label ?? null,
      issues: tech?.issues ?? [],
      citations: citation.results,
      search: search ?? null,
      backlinks: backlinks ?? null,
      aiOverview: aiOverview ?? null
    };
  } catch (e) {
    console.error(`[geo] tick failed for ${brand?.slug ?? brand?.id}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
