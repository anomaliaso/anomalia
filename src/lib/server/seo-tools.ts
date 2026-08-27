// Parse-only analysis behind the free SEO tools. Nothing here calls a paid API — it's one
// safeFetchUrl and regex/DOM-free parsing, so these tools are genuinely free to run and their
// only real limit is abuse (handled by tool-guard).
//
// Regex parsing rather than a DOM library on purpose: we only ever read <head> metadata, heading
// tags and href/src attributes, safeFetchUrl already truncates the body, and adding a parser
// dependency to read six tags is the definition of over-engineering. It is NOT robust against
// hostile markup — it doesn't need to be, since nothing here is rendered as HTML back to anyone.

export type Severity = 'high' | 'medium' | 'low';
export type Issue = { severity: Severity; title: string; detail: string };

const attr = (tag: string, name: string): string => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (m?.[2] ?? m?.[3] ?? m?.[4] ?? '').trim();
};

const tagsOf = (html: string, tag: string): string[] => html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) ?? [];

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// ── Meta tags / SERP snippet ─────────────────────────────────────────────────────────────────

export type MetaTagReport = {
  url: string;
  title: string;
  titleLength: number;
  description: string;
  descriptionLength: number;
  canonical: string;
  robots: string;
  viewport: string;
  lang: string;
  og: Record<string, string>;
  twitter: Record<string, string>;
  issues: Issue[];
};

// Google truncates around these pixel widths; character counts are the usual proxy and what
// every other tool shows, so we stay with characters rather than faking pixel measurement.
const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESC_MIN = 70;
const DESC_MAX = 160;

export function analyseMetaTags(html: string, url: string): MetaTagReport {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim().replace(/\s+/g, ' '));
  const metas = tagsOf(html, 'meta');
  const byName = (n: string): string => {
    const tag = metas.find((t) => attr(t, 'name').toLowerCase() === n);
    return tag ? decodeEntities(attr(tag, 'content')) : '';
  };

  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  for (const t of metas) {
    const prop = attr(t, 'property').toLowerCase();
    const name = attr(t, 'name').toLowerCase();
    const content = decodeEntities(attr(t, 'content'));
    if (prop.startsWith('og:')) og[prop.slice(3)] = content;
    if (name.startsWith('twitter:')) twitter[name.slice(8)] = content;
  }

  const description = byName('description');
  const canonical = tagsOf(html, 'link')
    .filter((t) => attr(t, 'rel').toLowerCase() === 'canonical')
    .map((t) => attr(t, 'href'))[0] ?? '';
  const robots = byName('robots');
  const viewport = byName('viewport');
  const lang = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang');

  const issues: Issue[] = [];
  if (!title) issues.push({ severity: 'high', title: 'Missing title', detail: 'The page has no <title>. It is the single strongest on-page signal and the headline of your search result.' });
  else if (title.length > TITLE_MAX) issues.push({ severity: 'medium', title: 'Title too long', detail: `${title.length} characters — Google truncates around ${TITLE_MAX}. The tail is invisible in results.` });
  else if (title.length < TITLE_MIN) issues.push({ severity: 'low', title: 'Title is short', detail: `${title.length} characters. There is room to add the qualifier or brand a searcher looks for.` });

  if (!description) issues.push({ severity: 'medium', title: 'Missing meta description', detail: 'Google will invent a snippet from page text. Writing it yourself is how you control the click.' });
  else if (description.length > DESC_MAX) issues.push({ severity: 'low', title: 'Description too long', detail: `${description.length} characters — expect truncation past ~${DESC_MAX}.` });
  else if (description.length < DESC_MIN) issues.push({ severity: 'low', title: 'Description is short', detail: `${description.length} characters. Short snippets waste the free ad space under your title.` });

  if (!canonical) issues.push({ severity: 'medium', title: 'No canonical URL', detail: 'Without rel=canonical, parameter and variant URLs can split ranking signals across duplicates.' });
  if (/noindex/i.test(robots)) issues.push({ severity: 'high', title: 'Page is set to noindex', detail: 'This page explicitly asks search engines not to index it. If that is unintended, it is why you are invisible.' });
  if (!viewport) issues.push({ severity: 'medium', title: 'No viewport meta', detail: 'Mobile rendering will be wrong, and Google indexes the mobile version first.' });
  if (!lang) issues.push({ severity: 'low', title: 'No lang attribute', detail: 'Set <html lang="…"> so engines and screen readers know the page language.' });
  if (!og.title || !og.image) issues.push({ severity: 'low', title: 'Incomplete Open Graph', detail: 'Missing og:title or og:image — shares on social and in chat apps will render as a bare link.' });

  return {
    url,
    title,
    titleLength: title.length,
    description,
    descriptionLength: description.length,
    canonical,
    robots,
    viewport,
    lang,
    og,
    twitter,
    issues
  };
}

// ── Structured data (JSON-LD) ────────────────────────────────────────────────────────────────

export type SchemaBlock = { types: string[]; valid: boolean; error?: string; raw: string };
export type SchemaReport = { url: string; blocks: SchemaBlock[]; types: string[]; microdataTypes: string[]; issues: Issue[] };

function collectTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) { for (const n of node) collectTypes(n, out); return; }
  if (!node || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  const t = rec['@type'];
  if (typeof t === 'string') out.add(t);
  if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.add(x);
  for (const v of Object.values(rec)) collectTypes(v, out);
}

export function analyseSchema(html: string, url: string): SchemaReport {
  const blocks: SchemaBlock[] = [];
  const all = new Set<string>();
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = (m[1] ?? '').trim();
    try {
      const parsed = JSON.parse(raw);
      const types = new Set<string>();
      collectTypes(parsed, types);
      for (const t of types) all.add(t);
      blocks.push({ types: [...types], valid: true, raw: raw.slice(0, 400) });
    } catch (e) {
      // Invalid JSON-LD is worse than none: Google drops the whole block silently.
      blocks.push({ types: [], valid: false, error: e instanceof Error ? e.message : 'Invalid JSON', raw: raw.slice(0, 400) });
    }
  }

  const microdataTypes = [...new Set(
    (html.match(/\bitemtype\s*=\s*["']([^"']+)["']/gi) ?? []).map((t) => (t.match(/["']([^"']+)["']/)?.[1] ?? '').split('/').pop() ?? '')
  )].filter(Boolean);

  const issues: Issue[] = [];
  const broken = blocks.filter((b) => !b.valid);
  if (broken.length) issues.push({ severity: 'high', title: `${broken.length} invalid JSON-LD block${broken.length > 1 ? 's' : ''}`, detail: 'Malformed JSON is ignored entirely — the markup is there but earns you nothing.' });
  if (!blocks.length && !microdataTypes.length) issues.push({ severity: 'medium', title: 'No structured data', detail: 'No JSON-LD or microdata found. Structured data is what makes rich results (ratings, FAQ, breadcrumbs) possible.' });
  if (blocks.length && !all.has('Organization') && !all.has('LocalBusiness') && !all.has('Person')) {
    issues.push({ severity: 'low', title: 'No entity markup', detail: 'Add Organization (or LocalBusiness/Person) so engines and LLMs can resolve who publishes this site.' });
  }
  if (blocks.length && !all.has('BreadcrumbList')) issues.push({ severity: 'low', title: 'No BreadcrumbList', detail: 'Breadcrumb markup replaces the raw URL in the result with a readable path.' });

  return { url, blocks, types: [...all], microdataTypes, issues };
}

// ── robots.txt ───────────────────────────────────────────────────────────────────────────────

export type RobotsRule = { userAgent: string; allow: string[]; disallow: string[]; crawlDelay: string | null };
export type RobotsReport = {
  url: string;
  found: boolean;
  raw: string;
  groups: RobotsRule[];
  sitemaps: string[];
  /** Verdict for the tested path, per user-agent. */
  tests: Array<{ userAgent: string; path: string; allowed: boolean; matchedRule: string | null }>;
  issues: Issue[];
};

// The AI crawlers worth reporting on separately — blocking these is what removes you from
// LLM answers, and it is usually done by accident via a blanket rule.
const AI_AGENTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

export function parseRobots(raw: string): { groups: RobotsRule[]; sitemaps: string[] } {
  const groups: RobotsRule[] = [];
  const sitemaps: string[] = [];
  // Per the spec, CONSECUTIVE User-agent lines share the rule block that follows them, so we
  // buffer agent names and only materialise groups once the first directive arrives.
  let pending: RobotsRule[] = [];
  let lastWasAgent = false;

  for (const line of raw.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) continue;
    const idx = clean.indexOf(':');
    if (idx < 0) continue;
    const key = clean.slice(0, idx).trim().toLowerCase();
    const value = clean.slice(idx + 1).trim();

    if (key === 'sitemap') { sitemaps.push(value); continue; }

    if (key === 'user-agent') {
      if (!lastWasAgent) pending = [];
      const rule: RobotsRule = { userAgent: value, allow: [], disallow: [], crawlDelay: null };
      pending.push(rule);
      groups.push(rule);
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!pending.length) continue;
    // Apply the directive to every agent that shares this block.
    for (const rule of pending) {
      if (key === 'allow') rule.allow.push(value);
      else if (key === 'disallow') rule.disallow.push(value);
      else if (key === 'crawl-delay') rule.crawlDelay = value;
    }
  }
  return { groups, sitemaps };
}

// robots.txt matching: longest matching pattern wins, Allow beats Disallow on equal length.
// Supports the * wildcard and the $ end-anchor, which is the whole of the de-facto standard.
function patternMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const rx = new RegExp('^' + body.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return rx.test(path);
}

export function isPathAllowed(groups: RobotsRule[], userAgent: string, path: string): { allowed: boolean; matchedRule: string | null } {
  const ua = userAgent.toLowerCase();
  // Most specific group wins: an exact agent block overrides the '*' block entirely.
  const exact = groups.filter((g) => g.userAgent.toLowerCase() === ua);
  const wildcard = groups.filter((g) => g.userAgent === '*');
  const applicable = exact.length ? exact : wildcard;
  if (!applicable.length) return { allowed: true, matchedRule: null };

  let best: { allowed: boolean; rule: string; len: number } | null = null;
  for (const g of applicable) {
    for (const p of g.disallow) {
      if (patternMatches(p, path) && (!best || p.length > best.len)) best = { allowed: false, rule: `Disallow: ${p}`, len: p.length };
    }
    for (const p of g.allow) {
      if (patternMatches(p, path) && (!best || p.length >= best.len)) best = { allowed: true, rule: `Allow: ${p}`, len: p.length };
    }
  }
  return best ? { allowed: best.allowed, matchedRule: best.rule } : { allowed: true, matchedRule: null };
}

export function analyseRobots(raw: string, url: string, testPath: string, found: boolean): RobotsReport {
  const { groups, sitemaps } = parseRobots(raw);
  const path = testPath || '/';
  const agents = ['*', 'Googlebot', ...AI_AGENTS];
  const tests = agents.map((ua) => ({ userAgent: ua, path, ...isPathAllowed(groups, ua, path) }));

  const issues: Issue[] = [];
  if (!found) {
    issues.push({ severity: 'medium', title: 'No robots.txt', detail: 'Everything is crawlable by default, which is usually fine — but you also lose the Sitemap directive that helps discovery.' });
    return { url, found, raw, groups, sitemaps, tests, issues };
  }
  const blocksEverything = groups.some((g) => g.userAgent === '*' && g.disallow.includes('/') && !g.allow.length);
  if (blocksEverything) issues.push({ severity: 'high', title: 'Entire site is disallowed', detail: 'A "Disallow: /" under User-agent: * blocks every crawler from the whole site.' });
  if (!sitemaps.length) issues.push({ severity: 'low', title: 'No Sitemap directive', detail: 'Add "Sitemap: https://…/sitemap.xml" so crawlers find your URL list without guessing.' });

  const blockedAi = tests.filter((t) => AI_AGENTS.includes(t.userAgent) && !t.allowed).map((t) => t.userAgent);
  if (blockedAi.length) {
    issues.push({
      severity: 'medium',
      title: `${blockedAi.length} AI crawler${blockedAi.length > 1 ? 's' : ''} blocked`,
      detail: `${blockedAi.join(', ')} cannot fetch this path. That removes the page from the answers those models give — deliberate for some brands, accidental for most.`
    });
  }
  return { url, found, raw, groups, sitemaps, tests, issues };
}

// ── Headings + image alt text ────────────────────────────────────────────────────────────────

export type HeadingNode = { level: number; text: string };
export type ContentReport = {
  url: string;
  headings: HeadingNode[];
  wordCount: number;
  images: { total: number; missingAlt: number; emptyAlt: number; samples: string[] };
  links: { internal: number; external: number; nofollow: number };
  issues: Issue[];
};

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function analyseContent(html: string, url: string): ContentReport {
  const headings: HeadingNode[] = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = decodeEntities(visibleText(m[2] ?? '')).slice(0, 160);
    if (text) headings.push({ level: Number(m[1]), text });
  }

  const imgTags = tagsOf(html, 'img');
  const missing: string[] = [];
  let missingAlt = 0;
  let emptyAlt = 0;
  for (const t of imgTags) {
    const hasAlt = /\balt\s*=/i.test(t);
    const altVal = attr(t, 'alt');
    if (!hasAlt) {
      missingAlt++;
      const src = attr(t, 'src');
      if (src && missing.length < 5) missing.push(src);
    } else if (!altVal) emptyAlt++;
  }

  let internal = 0, external = 0, nofollow = 0;
  const origin = (() => { try { return new URL(url).origin; } catch { return ''; } })();
  for (const t of tagsOf(html, 'a')) {
    const href = attr(t, 'href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    if (/\bnofollow\b/i.test(attr(t, 'rel'))) nofollow++;
    try {
      const abs = new URL(href, url);
      if (origin && abs.origin === origin) internal++; else external++;
    } catch { /* unparseable href, ignore */ }
  }

  const wordCount = visibleText(html).split(/\s+/).filter(Boolean).length;
  const h1s = headings.filter((h) => h.level === 1);
  const issues: Issue[] = [];

  if (!h1s.length) issues.push({ severity: 'high', title: 'No H1', detail: 'The page has no H1. It is the clearest statement of what the page is about, for readers and crawlers alike.' });
  else if (h1s.length > 1) issues.push({ severity: 'low', title: `${h1s.length} H1 tags`, detail: 'Multiple H1s dilute the topic signal. Keep one, demote the rest to H2.' });

  // A jump from H2 straight to H4 breaks the document outline assistive tech and parsers rely on.
  let previous = 0;
  for (const h of headings) {
    if (previous && h.level > previous + 1) {
      issues.push({ severity: 'low', title: 'Heading levels skip', detail: `An H${h.level} follows an H${previous} ("${h.text.slice(0, 40)}…"). Go one level at a time.` });
      break;
    }
    previous = h.level;
  }

  if (missingAlt) issues.push({ severity: 'medium', title: `${missingAlt} image${missingAlt > 1 ? 's' : ''} without alt`, detail: 'Missing alt text is an accessibility failure first and lost image-search context second.' });
  if (wordCount < 300) issues.push({ severity: 'medium', title: 'Thin content', detail: `About ${wordCount} words. Pages this short rarely rank for anything competitive.` });
  if (internal < 3) issues.push({ severity: 'low', title: 'Few internal links', detail: `${internal} internal links. Internal linking is how ranking strength reaches your deeper pages.` });

  return {
    url,
    headings,
    wordCount,
    images: { total: imgTags.length, missingAlt, emptyAlt, samples: missing },
    links: { internal, external, nofollow },
    issues
  };
}

/** Absolute, de-duplicated, http(s) links from a page — the crawl frontier for the link checker. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const t of tagsOf(html, 'a')) {
    const href = attr(t, 'href').trim();
    // In-page anchors would otherwise collapse to the page's own URL once the hash is stripped,
    // and the link checker would spend a request testing the page against itself.
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    try {
      const abs = new URL(href, baseUrl);
      abs.hash = '';
      if (abs.protocol === 'http:' || abs.protocol === 'https:') out.add(abs.toString());
    } catch { /* ignore */ }
  }
  return [...out];
}
