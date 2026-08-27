import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { env as publicEnv } from '$env/dynamic/public';
import { env } from '$env/dynamic/private';
import { genaiClient } from './brand-context';
import { aiStructured } from './xiaomi';
import { withBrandContext } from './ai-log';
import { fetchPage } from './brand-analysis';
import { scrapeCreatorsGet } from './scrapecreators';
import {
  executeWeekStrategy,
  renderPreviewImages,
  attachBrandMoodImages,
  isProduceApproved,
  postQcPayload,
  type ContentPrefs,
  type PreviewPost
} from './content-preview';
import { attachBrandPeople } from './people';
import { attachBrandPages } from './content-library';
import { enrichProfileWithMemory } from './brand-memory';
import { activeGtmBrief } from './gtm';
import { loadActivePlan, currentWeekIndex, selectFeaturableProducts } from './editorial-plan';
import { runDirector } from './director';
import { sendEmail } from './email';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { brandContacts } from './scheduler';
import { generateBlogFromNews } from './blog-generate';
import { hasProRadarLeads, isRadarKindAllowed, leadEngagePlatforms, radarSourceLimit, type RadarPlatformKey, RADAR_PLATFORM_KEYS } from './plans';
import { ALT_CAPTION_PLATFORMS, ensureShortNetworkCuts } from '$lib/platform-limits';
// Re-exported: Settings → Radar imports the type from here, next to the functions that use it.
export type { RadarPlatformKey } from './plans';
import { INTENT_RANK, normalizeIntent, type LeadIntent } from '$lib/leads-intent';
import {
  communityKeyOf,
  loadCommunityProfiles,
  profileKey,
  refreshCommunityProfiles,
  renderCommunityProfile,
  renderVocabularyDigest
} from './community-profile';

/** Conversation host → engage platform key (null = news/feed item, not a joinable thread). */
function engagePlatformOf(url: string, sourceName?: string): string | null {
  const u = (url ?? '').toLowerCase();
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('x.com') || u.includes('twitter.com')) return 'x';
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('reddit.com') || (sourceName ?? '').startsWith('r/')) return 'reddit';
  return null;
}

// ── Radar: the per-brand instant-marketing engine ────────────────────────────────────────────────
//
// traidue.com's auto-news pattern, generalised to every brand: configurable sources (Google News
// queries, RSS feeds, subreddits) → cron scan → ONE structured call that judges each fresh item's
// relevance FOR THIS BRAND (against its ai_context, editorial-plan week and GTM phase — the same
// news can be noise for one brand and central for another) → the relevant ones become PostSeeds
// and go through the EXISTING production machine (copywriter → copy chief → medium-locked render →
// QC → Director), landing as pending_user posts with the news citation attached — plus a one-click
// approve/reject email digest. Radar never publishes on its own.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type RadarPrefs = {
  enabled?: boolean;
  // 'digest' proposes up to maxPerDay posts on the normal approval queue; 'breaking' proposes only
  // urgency==='breaking' items (and flags them needs_attention so they surface first).
  mode?: 'digest' | 'breaking';
  maxPerDay?: number;
  // Reply suggestion style: 'professional' | 'casual' | 'friendly' | 'expert' | 'witty'
  replyTone?: string;
  // Free-text instructions for reply style (e.g. "Use metaphors", "Be concise", "Ask questions back")
  replyStyle?: string;
  // Free-text instructions from the user on WHAT makes a good lead for THIS brand: what to look
  // for, which conversations/news to prioritise, what to always skip. Injected into the relevance
  // judge AND the dynamic search-query generator so the whole radar follows the user's definition.
  leadInstructions?: string;
  // Email cadence. false (default) → ONE aggregated digest per day (sendDailyRadarRecap cron).
  // true → email at the end of every run that produced something, batching that run's leads into
  // one email (the daily recap then skips this brand so it isn't double-notified).
  emailPerRun?: boolean;
  // Coppie prima→dopo delle riscritture che l'utente fa sulle bozze di commento (azione rewrite
  // nella pagina Leads). Sono ground truth su cosa non andava nella bozza: il drafter le rilegge
  // al giro successivo per assorbire il gusto del proprietario. Niente tabelle nuove: vivono nel
  // jsonb content_prefs.radar già esistente (le migration non si applicano da sole al deploy).
  editPairs?: Array<{ before: string; after: string; feedback?: string; at?: string }>;
  /**
   * Master switches for default/generalist discovery platforms (Settings → Radar).
   * Missing/undefined = on. When off: skip dynamic search AND custom sources of that platform.
   * Pro-only keys (threads/x/linkedin) are always off on lower plans regardless of this map.
   */
  platforms?: Partial<Record<RadarPlatformKey, boolean>>;
};

/** Map a brand_news_sources.kind onto its platform master toggle (rss has none — always custom). */
export function sourceKindPlatform(kind: string): RadarPlatformKey | null {
  switch (kind) {
    case 'gnews_query':
      return 'gnews';
    case 'subreddit':
    case 'reddit_query':
      return 'reddit';
    case 'threads_query':
      return 'threads';
    case 'x_community':
      return 'x';
    case 'linkedin_query':
      return 'linkedin';
    default:
      return null;
  }
}

/** True when this platform may run for the brand (plan + prefs). Default = on. */
export function radarPlatformEnabled(
  prefs: RadarPrefs,
  key: RadarPlatformKey,
  plan: string | null | undefined
): boolean {
  if ((key === 'threads' || key === 'x' || key === 'linkedin') && !hasProRadarLeads(plan)) {
    return false;
  }
  return prefs.platforms?.[key] !== false;
}

export function radarPrefsOf(contentPrefs: AnyRec | null | undefined): RadarPrefs {
  const r = (contentPrefs?.radar ?? {}) as RadarPrefs;
  const rawPlat = r.platforms && typeof r.platforms === 'object' ? r.platforms : {};
  const platforms: Partial<Record<RadarPlatformKey, boolean>> = {};
  for (const k of RADAR_PLATFORM_KEYS) {
    if (typeof (rawPlat as Record<string, unknown>)[k] === 'boolean') {
      platforms[k] = (rawPlat as Record<string, boolean>)[k];
    }
  }
  // editPairs: solo coppie valide, ultime 5, troncate — un jsonb scritto da altri percorsi non
  // deve mai poter gonfiare o rompere il prompt del drafter.
  const rawPairs = Array.isArray((r as AnyRec).editPairs) ? ((r as AnyRec).editPairs as AnyRec[]) : [];
  const editPairs = rawPairs
    .filter((p) => p && typeof p === 'object' && typeof p.before === 'string' && typeof p.after === 'string' && p.before.trim() && p.after.trim())
    .slice(-5)
    .map((p) => ({
      before: String(p.before).slice(0, 600),
      after: String(p.after).slice(0, 600),
      ...(typeof p.feedback === 'string' && p.feedback.trim() ? { feedback: String(p.feedback).slice(0, 200) } : {}),
      ...(typeof p.at === 'string' ? { at: String(p.at) } : {})
    }));
  return {
    enabled: r.enabled === true,
    mode: r.mode === 'breaking' ? 'breaking' : 'digest',
    maxPerDay: Math.max(1, Math.min(3, Number(r.maxPerDay) || 1)),
    replyTone: r.replyTone || 'friendly',
    replyStyle: r.replyStyle ?? 'Sii cinico. Non usare mai il trattino em-dash (—); usa solo punti e virgole. Scrivi in modo diretto, senza fronzoli, senza allungare il testo. Sii conciso. Scrivi come una persona che digita velocemente, non come un\'AI. No emoji.',
    leadInstructions: typeof r.leadInstructions === 'string' ? r.leadInstructions.trim().slice(0, 2000) : '',
    emailPerRun: r.emailPerRun === true,
    editPairs,
    platforms
  };
}

// ── Feed fetching (zero dependencies) ───────────────────────────────────────────────────────────

export type FeedItem = { title: string; url: string; snippet: string; sourceName: string; publishedAt: string | null };

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? strip(m[1]) : '';
};

// Reddit's rising RSS is fetched from old.reddit.com (less fingerprint-blocked), but those feeds
// emit old.reddit.com permalinks. Always rewrite to www so /leads and digest emails open the
// current Reddit UI — never the classic old.reddit skin.
export function normalizeRedditUrl(url: string): string {
  const u = (url ?? '').trim();
  if (!u) return u;
  if (u.startsWith('/r/') || u.startsWith('/user/') || u.startsWith('/u/')) return `https://www.reddit.com${u}`;
  return u.replace(/^https?:\/\/(old\.|new\.|www\.)?reddit\.com/i, 'https://www.reddit.com');
}

// Tolerant RSS 2.0 + Atom parser: enough for Google News, standard RSS and Reddit's Atom feeds.
// ponytail: regex XML parsing — fine for well-formed feeds; swap for a real parser if a needed
// source ever breaks it.
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const title = tag(b, 'title');
    // RSS: <link>url</link>. Atom/Reddit: <link href="url"/>.
    let url = tag(b, 'link');
    if (!url) url = b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? '';
    if (!title || !url) continue;
    const snippet = (tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 1000);
    const sourceName = tag(b, 'source') || tag(b, 'author') || '';
    const dateRaw = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated');
    const t = dateRaw ? Date.parse(dateRaw) : NaN;
    const cleaned = strip(url);
    out.push({
      title,
      url: /reddit\.com/i.test(cleaned) || cleaned.startsWith('/r/') ? normalizeRedditUrl(cleaned) : cleaned,
      snippet,
      sourceName,
      publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString()
    });
  }
  return out;
}

const FEED_TIMEOUT_MS = 10_000;
const ITEMS_PER_FEED = 15;

function feedUrlFor(source: { kind: string; value: string; lang?: string | null }): string {
  if (source.kind === 'gnews_query') {
    const lang = (source.lang ?? 'auto').toLowerCase();
    if (lang === 'auto') {
      // Auto: no locale params — Google decides based on query
      return `https://news.google.com/rss/search?q=${encodeURIComponent(source.value)}`;
    }
    // Map language code → Google News hl/gl/ceid
    const LANG_MAP: Record<string, [string, string, string]> = {
      en: ['en-US', 'US', 'US:en'], it: ['it', 'IT', 'IT:it'], es: ['es', 'ES', 'ES:es'],
      fr: ['fr', 'FR', 'FR:fr'], de: ['de', 'DE', 'DE:de'], pt: ['pt-BR', 'BR', 'BR:pt'],
      nl: ['nl', 'NL', 'NL:nl'], pl: ['pl', 'PL', 'PL:pl'], ro: ['ro', 'RO', 'RO:ro'],
      sv: ['sv', 'SE', 'SE:sv'], no: ['no', 'NO', 'NO:no'], da: ['da', 'DK', 'DK:da'],
      fi: ['fi', 'FI', 'FI:fi'], cs: ['cs', 'CZ', 'CZ:cs'], sk: ['sk', 'SK', 'SK:sk'],
      hu: ['hu', 'HU', 'HU:hu'], hr: ['hr', 'HR', 'HR:hr'], sr: ['sr', 'RS', 'RS:sr'],
      sl: ['sl', 'SI', 'SI:sl'], bg: ['bg', 'BG', 'BG:bg'], uk: ['uk', 'UA', 'UA:uk'],
      ru: ['ru', 'RU', 'RU:ru'], tr: ['tr', 'TR', 'TR:tr'], el: ['el', 'GR', 'GR:el'],
      ar: ['ar', 'SA', 'SA:ar'], he: ['he', 'IL', 'IL:he'], fa: ['fa', 'IR', 'IR:fa'],
      hi: ['hi', 'IN', 'IN:hi'], th: ['th', 'TH', 'TH:th'], vi: ['vi', 'VN', 'VN:vi'],
      id: ['id', 'ID', 'ID:id'], ms: ['ms', 'MY', 'MY:ms'], zh: ['zh-CN', 'CN', 'CN:zh'],
      ja: ['ja', 'JP', 'JP:ja'], ko: ['ko', 'KR', 'KR:ko'],
    };
    const [hl, gl, ceid] = LANG_MAP[lang] ?? ['en-US', 'US', 'US:en'];
    return `https://news.google.com/rss/search?q=${encodeURIComponent(source.value)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  }
  if (source.kind === 'subreddit') return redditRssAuth(`https://www.reddit.com/r/${source.value.replace(/^r\//, '')}/.rss`);
  return source.value; // plain RSS url
}

async function fetchFeed(source: { kind: string; value: string; lang?: string | null; name?: string }): Promise<FeedItem[]> {
  try {
    const res = await fetch(feedUrlFor(source), {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AnomaliaRadar/1.0)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }
    });
    if (!res.ok) return [];
    return parseFeed(await res.text()).slice(0, ITEMS_PER_FEED);
  } catch {
    return []; // a dead feed never breaks the scan
  }
}

// ── Reddit engage sources (timing-aware) ────────────────────────────────────────────────────────
// A good comment lands on a thread that's RISING right now. Reddit's unauthenticated JSON API is
// gone (403), but the RSS endpoints still serve: /r/{sub}/rising/.rss for the timing signal and
// {permalink}/.rss for a thread's body + comments. READ-ONLY by design: Anomalia never posts or
// comments; it only drafts a suggestion for the human. ponytail: on a 429 the catch returns [] —
// if reddit tightens further, the upgrade path is the official OAuth API (read scope).
const ENGAGE_MAX_AGE_HOURS = 12;
// Threads / X / LinkedIn are a different clock. Their search endpoints rank by relevance, not
// recency (Threads has no date filter at all), and a post there stays live for days instead of
// falling off a rising list in hours. Cutting them at 12h threw away nearly every result — the
// scan logged "0 items" and looked like an empty feed rather than a window that was too narrow.
const CONVERSATION_MAX_AGE_HOURS = 48;
type RedditItem = FeedItem & { createdUtc: number };

const REDDIT_UA = 'AnomaliaRadar/1.0 (read-only; instant-marketing suggestions)';

// Personal-feed auth for Reddit RSS: since 2026 the anonymous feeds are fingerprint-blocked from
// servers, but every account has a private feed token (reddit.com/prefs/feeds) — appending
// ?feed=TOKEN&user=USERNAME turns the request into the user's own authenticated feed and passes.
// Simpler than OAuth and read-only by construction. '' when the env isn't set.
function redditRssAuth(url: string): string {
  const feed = env.REDDIT_FEED_TOKEN;
  const user = env.REDDIT_FEED_USER;
  if (!feed || !user) return url;
  return `${url}${url.includes('?') ? '&' : '?'}feed=${encodeURIComponent(feed)}&user=${encodeURIComponent(user)}`;
}

// Fetch a Reddit URL's raw body, dodging the TLS-fingerprint wall: Reddit 403s server HTTP clients
// (Node/undici) even with valid feed auth, while real browsers pass. Chain: plain fetch (in case
// this network passes) → Browserless (REAL Chrome, real fingerprint — verified: curl/browser 200
// where Node 403). null when both fail. ~1 Browserless unit per call; reddit traffic is a handful
// of requests per day.
async function fetchRedditText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { 'User-Agent': REDDIT_UA } });
    if (res.ok) return await res.text();
  } catch { /* fall through to browserless */ }
  try {
    const { isBrowserlessConfigured, browserlessFunction } = await import('./browserless');
    if (!isBrowserlessConfigured()) return null;
    const out = await browserlessFunction(
      `export default async ({ page, context }) => {
        const res = await page.goto(context.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (!res || res.status() >= 400) return null;
        return await res.text();
      }`,
      { url }
    );
    return typeof out === 'string' && out.trim() ? out : null;
  } catch {
    return null;
  }
}

// Read-only OAuth (script app, client_credentials): Reddit fingerprints and 429s non-browser
// clients on the anonymous endpoints, and the OFFICIAL API is also the TOS-clean way to read.
// Token cached ~50min. Missing env → null (subreddit sources are skipped with a warn, everything
// else keeps working). Setup: create a "script" app on reddit.com/prefs/apps and set
// REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET.
let redditToken: { token: string; exp: number } | null = null;
async function redditAccessToken(): Promise<string | null> {
  const id = env.REDDIT_CLIENT_ID;
  const secret = env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken && Date.now() < redditToken.exp) return redditToken.token;
  try {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_UA
      },
      body: 'grant_type=client_credentials'
    });
    if (!res.ok) return null;
    const d = (await res.json()) as AnyRec;
    if (!d?.access_token) return null;
    redditToken = { token: String(d.access_token), exp: Date.now() + 50 * 60 * 1000 };
    return redditToken.token;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function redditGet(path: string): Promise<any | null> {
  const token = await redditAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://oauth.reddit.com${path}`, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': REDDIT_UA }
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// NOTE (verified live 2026-07-03): Exa (exa.ai) is NOT an option for Reddit — the API rejects
// includeDomains:['reddit.com'] ("domain not available") and its index contains zero reddit URLs
// (Reddit's data is exclusively licensed). For server-side Reddit reads the ONLY reliable path is
// the official OAuth API below.
// Fair-share selection: round-robin one item per origin per pass, up to `cap`. Guarantees every
// source with fresh content contributes before any single source takes a second slot — so a
// high-volume source can't starve the others (see radarScan). Pure + exported for tests.
export function roundRobin<T>(byOrigin: Map<string, T[]>, cap: number): T[] {
  const qList = [...byOrigin.values()];
  const out: T[] = [];
  while (out.length < cap && qList.some((q) => q.length)) {
    for (const q of qList) {
      if (!q.length) continue;
      out.push(q.shift()!);
      if (out.length >= cap) break;
    }
  }
  return out;
}

async function fetchSubredditRising(sub: string): Promise<RedditItem[]> {
  const clean = sub.replace(/^r\//, '').replace(/\/+$/, '');
  // PRIMARY: ScrapeCreators' Reddit endpoint — same key/gateway the whole app already uses for
  // IG/TikTok/etc., with real `rising` sort and full post fields. The chains below (OAuth, RSS)
  // stay as fallbacks.
  try {
    const data = await scrapeCreatorsGet(`/v1/reddit/subreddit?subreddit=${encodeURIComponent(clean)}&sort=rising&trim=true`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: AnyRec[] = Array.isArray(data?.posts) ? data.posts : Array.isArray(data?.data?.children) ? data.data.children.map((c: any) => c?.data ?? c) : [];
    const mapped = raw
      .map((d) => ({
        title: String(d?.title ?? ''),
        url: d?.permalink ? `https://www.reddit.com${String(d.permalink).startsWith('/') ? d.permalink : `/${d.permalink}`}` : String(d?.url ?? ''),
        snippet: String(d?.selftext ?? '').slice(0, 1000),
        sourceName: `r/${clean}`,
        publishedAt: d?.created_utc ? new Date(Number(d.created_utc) * 1000).toISOString() : null,
        createdUtc: Number(d?.created_utc) || 0
      }))
      .filter((i) => i.title && i.url.includes('/comments/'));
    if (mapped.length) return mapped;
  } catch (e) {
    console.warn(`[radar] scrapecreators reddit r/${clean} failed:`, e instanceof Error ? e.message.slice(0, 120) : e);
  }
  // Primary: official API (rich data — created_utc, selftext). Fallback: the RSS endpoint, which
  // works from some networks (curl-like clients) but is fingerprint-blocked from most servers.
  const data = await redditGet(`/r/${encodeURIComponent(clean)}/rising?limit=15`);
  if (data) {
    return ((data?.data?.children ?? []) as AnyRec[])
      .map((c) => {
        const d = c?.data ?? {};
        return {
          title: String(d.title ?? ''),
          url: `https://www.reddit.com${d.permalink ?? ''}`,
          snippet: String(d.selftext ?? '').slice(0, 1000),
          sourceName: `r/${clean}`,
          publishedAt: d.created_utc ? new Date(Number(d.created_utc) * 1000).toISOString() : null,
          createdUtc: Number(d.created_utc) || 0
        };
      })
      .filter((i) => i.title && i.url.includes('/comments/'));
  }
  const xml = await fetchRedditText(redditRssAuth(`https://old.reddit.com/r/${encodeURIComponent(clean)}/rising/.rss`));
  if (!xml) {
    console.warn(`[radar] reddit r/${clean} unavailable — set REDDIT_FEED_TOKEN/USER (prefs/feeds) or REDDIT_CLIENT_ID/SECRET`);
    return [];
  }
  return parseFeed(xml)
    .filter((i) => i.url.includes('/comments/'))
    .map((i) => ({ ...i, sourceName: `r/${clean}`, createdUtc: i.publishedAt ? Date.parse(i.publishedAt) / 1000 : 0 }));
}

// Conversation searches (Threads / Reddit / LinkedIn / X) all go through ScrapeCreators.
//
// Errors PROPAGATE on purpose. These used to `catch { return [] }`, so a wrong parameter or an
// expired key was logged in radar_searches as "0 items" — indistinguishable from "no conversation
// worth joining today". That is how the X source stayed silently dead: it was called with `id=`
// where the endpoint wants `url=`, and every scan reported a clean, empty success.

// Threads keyword search (/v1/threads/search): up to 10 posts per query (Threads' own ceiling),
// with engagement counts and taken_at for the freshness cut.
async function fetchThreadsSearch(query: string): Promise<RedditItem[]> {
  // NB: the endpoint's start_date filter returns 0 results (verified live) — fetch unfiltered
  // and let the caller's createdUtc cutoff do the freshness cut.
  const data = await scrapeCreatorsGet(`/v1/threads/search?query=${encodeURIComponent(query)}&trim=true`);
  return ((data?.posts ?? []) as AnyRec[])
    .map((post) => ({
      title: String(post?.caption?.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
      url: post?.code && post?.user?.username ? `https://www.threads.net/@${post.user.username}/post/${post.code}` : '',
      snippet: String(post?.caption?.text ?? '').slice(0, 1000),
      sourceName: `threads${post?.user?.username ? ` · @${post.user.username}` : ''}`,
      publishedAt: post?.taken_at ? new Date(Number(post.taken_at) * 1000).toISOString() : null,
      createdUtc: Number(post?.taken_at) || 0
    }))
    .filter((i) => i.title && i.url);
}

// Global Reddit keyword search (/v1/reddit/search): finds conversations across ALL of Reddit,
// not just the brand's own subreddits — same shape as fetchThreadsSearch.
async function fetchRedditSearch(query: string): Promise<RedditItem[]> {
  const data = await scrapeCreatorsGet(`/v1/reddit/search?query=${encodeURIComponent(query)}&sort=new&timeframe=day&trim=true`);
  return ((data?.posts ?? []) as AnyRec[])
    .map((post) => ({
      title: String(post?.title ?? ''),
      url: post?.permalink ? `https://www.reddit.com${String(post.permalink).startsWith('/') ? post.permalink : `/${post.permalink}`}` : String(post?.url ?? ''),
      snippet: String(post?.selftext ?? '').slice(0, 1000),
      // Keep the `r/` prefix: the verdict prompt's Reddit conversation ruler and the UI both key
      // off it to treat these like subreddit items.
      sourceName: `r/${post?.subreddit ?? ''}`,
      publishedAt: post?.created_utc ? new Date(Number(post.created_utc) * 1000).toISOString() : null,
      createdUtc: Number(post?.created_utc) || 0
    }))
    .filter((i) => i.title && i.url.includes('/comments/'));
}

/**
 * LinkedIn's search says "nessun post corrisponde" with a **404 `not_found`** and charges zero
 * credits — un risultato vuoto vestito da errore. Verificato in produzione: due query hanno preso
 * 404 mentre il catalogo globale aveva 15 post LinkedIn presi dallo stesso endpoint quel mattino,
 * e il giorno prima la stessa query dinamica ne aveva restituiti 2.
 *
 * Il riconoscimento è volutamente stretto — solo il corpo documentato del no-match — perché ogni
 * altro 404 (path sbagliato, endpoint rimosso) resta un errore vero e deve continuare a urlare.
 */
export function isNoMatch404(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return m.startsWith('scrapecreators 404') && m.includes('"not_found"');
}

// Global LinkedIn keyword search (/v1/linkedin/search/posts): the B2B lead surface.
// `date_posted=last-day` keeps it fresh; the post's full text rides in `snippet`, so the comment
// drafter can work off it without a second fetch (LinkedIn has no comments endpoint here).
async function fetchLinkedInSearch(query: string): Promise<RedditItem[]> {
  let data: AnyRec | null;
  try {
    data = await scrapeCreatorsGet(`/v1/linkedin/search/posts?query=${encodeURIComponent(query)}&date_posted=last-day`);
  } catch (e) {
    // "Nessun post" non è un guasto: segnarlo rosso nella cronologia scan sarebbe l'errore opposto
    // a quello che abbiamo appena tolto — gridare al lupo invece di tacere. Resta nei log.
    if (isNoMatch404(e)) {
      console.warn(`[radar] linkedin search: nessun risultato per "${query.slice(0, 60)}"`);
      return [];
    }
    throw e;
  }
  return ((data?.posts ?? []) as AnyRec[])
    .map((post) => {
      const text = String(post?.description ?? '').replace(/\s+/g, ' ').trim();
      const ts = post?.datePublished ? Date.parse(String(post.datePublished)) : NaN;
      return {
        title: text.slice(0, 200),
        url: String(post?.url ?? ''),
        snippet: text.slice(0, 1000),
        sourceName: `linkedin${post?.author?.name ? ` · ${post.author.name}` : ''}`,
        publishedAt: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
        createdUtc: Number.isNaN(ts) ? 0 : ts / 1000
      };
    })
    .filter((i) => i.title && i.url);
}

// Settings asks for the X community ID, but people paste the whole URL — accept either and hand
// the endpoint the URL it actually documents.
export function xCommunityUrl(value: string): string {
  const v = String(value ?? '').trim();
  const id = v.match(/communities\/(\d+)/)?.[1] ?? v.replace(/\D/g, '');
  return id ? `https://x.com/i/communities/${id}` : '';
}

// X Community tweets (X sells keyword search only via its paid API — niche communities are the
// engage surface there). Value = the community id from its URL.
async function fetchXCommunityTweets(communityId: string): Promise<RedditItem[]> {
  const url = xCommunityUrl(communityId);
  if (!url) throw new Error(`x_community: "${communityId}" has no community id in it`);
  // The endpoint takes `url`, NOT `id` — see docs.scrapecreators.com/v1/twitter/community/tweets.
  const data = await scrapeCreatorsGet(`/v1/twitter/community/tweets?url=${encodeURIComponent(url)}&trim=true`);
  const raw: AnyRec[] = Array.isArray(data?.tweets) ? data.tweets : Array.isArray(data?.data) ? data.data : [];
  return raw
    .map((t) => {
      const ts = t?.created_at ? Date.parse(String(t.created_at)) : NaN;
      const id = String(t?.id_str ?? t?.rest_id ?? t?.id ?? '');
      return {
        title: String(t?.full_text ?? t?.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
        url: id ? `https://x.com/i/status/${id}` : '',
        snippet: String(t?.full_text ?? t?.text ?? '').slice(0, 1000),
        sourceName: 'x community',
        publishedAt: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
        createdUtc: Number.isNaN(ts) ? 0 : ts / 1000
      };
    })
    .filter((i) => i.title && i.url);
}

// ── Source seeding (once, at onboarding — user-editable in the Studio) ──────────────────────────

const SOURCES_SCHEMA = {
  type: 'object' as const,
  properties: {
    gnews_queries: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const, description: 'A Google News search query with OR-groups, tuned to this brand\'s beat.' },
          lang: { type: 'string' as const, enum: ['it', 'en'] as const }
        },
        required: ['query', 'lang']
      },
      description: '3-5 queries covering the brand\'s beat: its niche, its market, the public debate it should react to. Mix the brand\'s own language and English for global coverage when the beat is global.'
    },
    subreddits: { type: 'array' as const, items: { type: 'string' as const }, description: '0-3 REAL, active subreddit names (without r/) where this brand\'s topic is discussed. Empty if none clearly fit.' },
    reddit_queries: { type: 'array' as const, items: { type: 'string' as const }, description: '0-2 Reddit keyword-search queries (plain keywords, no boolean operators) to find conversations across ALL of Reddit where this brand\'s expertise helps. Empty if none fit.' }
  },
  required: ['gnews_queries', 'subreddits', 'reddit_queries']
};

// Propose the brand's news sources from its profile — Google News queries always work (no dead
// URLs), subreddits when the niche has them. Idempotent (unique constraint absorbs re-runs).
export async function seedSourcesForBrand(
  admin: SupabaseClient,
  brandId: string,
  profile: AnyRec,
  outputLanguage = 'Italian',
  plan?: string | null
): Promise<number> {
  console.log(`[radar] seedSourcesForBrand called for brand ${brandId}, profile name: ${profile?.name ?? 'n/a'}`);
  const ai = genaiClient();
  const pillars = Array.isArray(profile?.content_pillars) ? profile.content_pillars.join('; ') : '';
  const prompt = `Design the NEWS SOURCES for this brand's instant-marketing radar — the searches that will surface the news, debates and events this brand should react to with timely posts.

Brand: ${profile?.name ?? ''}
About: ${String(profile?.about ?? '').slice(0, 400)}
Category: ${profile?.category ?? ''}
Content pillars: ${pillars || 'n/a'}
Audience: ${profile?.target_audience ?? ''}
Brand language: ${outputLanguage}

Queries must be SPECIFIC to the beat (never generic like "news" or the bare brand name) and use OR-groups of synonyms the way a press office would. Only propose subreddits you are confident actually exist and are active.`;
  let out: { gnews_queries?: Array<{ query: string; lang: string }>; subreddits?: string[]; reddit_queries?: string[] };
  try {
    out = await aiStructured<{ gnews_queries?: Array<{ query: string; lang: string }>; subreddits?: string[]; reddit_queries?: string[] }>(
      ai, prompt, SOURCES_SCHEMA, 'You are a media-monitoring specialist setting up press-review sources.', 'return_radar_sources'
    );
  } catch (e) {
    console.warn('[radar] seedSourcesForBrand AI call failed:', e instanceof Error ? e.message : e);
    return 0;
  }
  console.log('[radar] seedSourcesForBrand AI response:', JSON.stringify(out));
  const rows: AnyRec[] = [];
  for (const q of (out.gnews_queries ?? []).slice(0, 5)) {
    if (q?.query?.trim()) rows.push({ brand_id: brandId, kind: 'gnews_query', value: q.query.trim(), lang: q.lang || 'auto' });
  }
  for (const s of (out.subreddits ?? []).slice(0, 3)) {
    const sub = String(s ?? '').replace(/^r\//, '').trim();
    if (sub) rows.push({ brand_id: brandId, kind: 'subreddit', value: sub, lang: 'en' });
  }
  for (const q of (out.reddit_queries ?? []).slice(0, 2)) {
    if (q?.trim()) rows.push({ brand_id: brandId, kind: 'reddit_query', value: q.trim(), lang: 'en' });
  }
  if (!rows.length) { console.warn('[radar] seedSourcesForBrand: no rows generated'); return 0; }

  // Honour the plan's custom-source cap (Go=5, Starter=10, Pro=30). Prefer keeping a mix:
  // gnews first, then subreddits, then reddit queries — already the insert order above.
  const limit = radarSourceLimit(plan);
  const capped = rows.slice(0, limit);

  const { error } = await admin.from('brand_news_sources').upsert(capped, { onConflict: 'brand_id,kind,value', ignoreDuplicates: true });
  if (error) { console.warn('[radar] seedSourcesForBrand upsert failed:', error.message); return 0; }
  console.log(`[radar] seedSourcesForBrand: inserted ${capped.length}/${rows.length} sources for brand ${brandId} (limit ${limit})`);
  return capped.length;
}

// ── Scan: fetch → dedupe → relevance verdict ────────────────────────────────────────────────────

export type RadarVerdictItem = {
  id: string; url: string; title: string; snippet: string; sourceName: string;
  relevance: number; angle: string; urgency: 'breaking' | 'timely'; pillar: string;
  // 'post' → newsjack post through the production machine; 'comment' → a Reddit/Threads/X conversation
  // the brand should join MANUALLY (Anomalia drafts the comment, the human posts it); 'article' → a
  // deep, evergreen blog article draft (only when the brand's blog is active).
  action: 'post' | 'comment' | 'article';
  // How close this person is to buying — see LEAD_INTENTS. Feed items are always 'none'.
  intent: LeadIntent;
};

// Intent lives in `$lib/leads-intent` so the Leads page can rank and label without importing the
// server-side Radar module; re-exported here because every server caller reaches for it via radar.
export { LEAD_INTENTS, INTENT_RANK, normalizeIntent } from '$lib/leads-intent';
export type { LeadIntent } from '$lib/leads-intent';

const VERDICT_SCHEMA = {
  type: 'object' as const,
  properties: {
    verdicts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'integer' as const },
          relevant: { type: 'boolean' as const, description: 'true only when THIS brand should visibly react to this item.' },
          relevance: { type: 'integer' as const, description: '0-100. 80+ = central to the beat; below 50 is never relevant.' },
          angle: { type: 'string' as const, description: "The post's one-line angle IN THE BRAND'S LANGUAGE — what the brand says about this, in its voice. Empty when not relevant." },
          urgency: { type: 'string' as const, enum: ['breaking', 'timely', 'none'] as const, description: 'breaking = react today; timely = fits this week; none = not relevant.' },
          action: { type: 'string' as const, enum: ['post', 'comment', 'article', 'none'] as const, description: "How the brand should react: 'post' = publish its own social post about this news; 'comment' = join the conversation with a useful reply (ONLY for Reddit/Threads/X threads where the brand's expertise genuinely helps — never pure promotion); 'article' = a deep, substantive blog article draft expanding on this from the brand's expertise (ONLY when the brand's blog is active and the topic has enough depth for long-form, not just a quick social reaction); 'none' = not relevant." },
          pillar: { type: 'string' as const, description: "Which of the brand's content pillars this serves. Empty if none." },
          intent: { type: 'string' as const, enum: ['seeking_now', 'comparing', 'researching', 'venting', 'none'] as const, description: "For CONVERSATIONS only, how close this PERSON is to buying — judge the person, not the topic: 'seeking_now' = explicitly asking for a recommendation or a solution right now; 'comparing' = weighing named options; 'researching' = trying to understand the problem, no purchase in sight; 'venting' = complaining, wants peers not vendors; 'none' = not a person with this problem (news and feed items are always 'none')." },
          skip_reason: { type: 'string' as const, description: 'One short line on WHY it was skipped (empty when relevant) — shown to the user for transparency.' }
        },
        required: ['index', 'relevant', 'relevance', 'angle', 'urgency', 'pillar', 'action', 'intent', 'skip_reason']
      }
    }
  },
  required: ['verdicts']
};

const MAX_ITEMS_PER_SCAN = 40;

// A source is brand-AGNOSTIC to fetch: r/marketing's rising threads are the same for every brand
// watching it. Key by (kind, value, lang) so identical sources across brands dedup to ONE fetch.
type SourceRef = { kind: string; value: string; lang?: string | null };
export const sourceKey = (s: SourceRef): string => `${s.kind}|${s.value}|${s.lang ?? ''}`;

/** How old a conversation may be, per platform. Reddit rising = now; the rest = a couple of days. */
export function maxAgeHoursFor(kind: string): number {
  return kind === 'subreddit' || kind === 'reddit_query' ? ENGAGE_MAX_AGE_HOURS : CONVERSATION_MAX_AGE_HOURS;
}

/** Drop conversations older than their platform's window. Applied to stored AND dynamic searches. */
export function withinWindow(kind: string, items: RedditItem[]): RedditItem[] {
  const cutoff = Date.now() / 1000 - maxAgeHoursFor(kind) * 3600;
  return items.filter((i) => i.createdUtc >= cutoff);
}

// Fetch ONE source's feed (already time-filtered where timing matters). The unit of the shared cache.
async function fetchSourceFeed(s: SourceRef): Promise<FeedItem[]> {
  if (s.kind === 'threads_query') return withinWindow(s.kind, await fetchThreadsSearch(s.value));
  if (s.kind === 'x_community') return withinWindow(s.kind, await fetchXCommunityTweets(s.value));
  // linkedin_query was missing here: the source fell through to fetchFeed(), which fetched the
  // KEYWORDS as if they were an RSS url. Every LinkedIn source returned nothing, forever.
  if (s.kind === 'linkedin_query') return withinWindow(s.kind, await fetchLinkedInSearch(s.value));
  if (s.kind === 'reddit_query') return withinWindow(s.kind, await fetchRedditSearch(s.value));
  if (s.kind !== 'subreddit') return fetchFeed(s);
  // TIMING: only RISING (momentum right now), hard-cut at ENGAGE_MAX_AGE_HOURS — a comment on a
  // stale thread is wasted breath.
  return withinWindow(s.kind, await fetchSubredditRising(s.value));
}

// How long a cached feed is considered fresh. Ticks run every ~4h; 3h TTL covers the gap so
// workers processing brands minutes after the orchestrator always read valid data.
const FEED_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

// Fetch every DISTINCT source across the given brands exactly once → write to radar_feed_cache (DB).
// Workers read this cache instead of refetching, so N brands watching r/marketing hit it once and
// the fetch survives across separate function invocations (unlike an in-memory Map). The AI
// relevance judging stays per-brand (radarScan); only the fetch is shared.
export async function buildRadarFeedCache(admin: SupabaseClient, brandIds: string[]): Promise<number> {
  if (!brandIds.length) return 0;
  const [{ data: sources }, { data: brands }] = await Promise.all([
    admin.from('brand_news_sources').select('kind, value, lang, brand_id').in('brand_id', brandIds).eq('active', true),
    admin.from('brands').select('id, plan').in('id', brandIds)
  ]);
  const planById = new Map((brands ?? []).map((b) => [b.id as string, b.plan as string | null]));
  const uniq = new Map<string, SourceRef>();
  for (const s of sources ?? []) {
    // Skip premium lead sources for free/starter brands so we don't burn ScrapeCreators quota.
    if (!isRadarKindAllowed(String(s.kind), planById.get(s.brand_id as string))) continue;
    uniq.set(sourceKey(s), { kind: s.kind, value: s.value, lang: s.lang ?? null });
  }
  if (!uniq.size) return 0;
  const now = new Date().toISOString();
  const fetched = await Promise.all(
    [...uniq.entries()].map(async ([key, s]) => {
      try {
        return { source_key: key, items: await fetchSourceFeed(s), fetched_at: now };
      } catch (e) {
        // A FAILED fetch is never cached. Caching it as an empty list would hand the per-brand
        // scan a clean cache hit with zero items, and the error would vanish exactly the way the
        // old `catch { return [] }` made it vanish. Leaving the cache cold makes the scan refetch
        // and record the real error in radar_searches.
        console.warn('[radar] feed cache miss for', key, e instanceof Error ? e.message.slice(0, 120) : e);
        return null;
      }
    })
  );
  const rows = fetched.filter((r): r is { source_key: string; items: FeedItem[]; fetched_at: string } => r !== null);
  if (rows.length) await admin.from('radar_feed_cache').upsert(rows, { onConflict: 'source_key' });
  return rows.length;
}

/**
 * Live self-test of a brand's Radar sources — what the CLI/API `radar diagnose` returns.
 *
 * Every source is fetched FOR REAL (no cache), so the answer to "why does LinkedIn find nothing"
 * is the endpoint's own error rather than a shrug. It exists because the failure mode here is
 * always silence: a source that is plan-gated, toggled off, or erroring all look identical from
 * the outside — an empty leads page.
 */
export async function radarDiagnose(
  admin: SupabaseClient,
  brand: { id: string; plan?: string | null; content_prefs?: AnyRec | null }
): Promise<AnyRec> {
  const prefs = radarPrefsOf(brand.content_prefs);
  const { data: rows } = await admin
    .from('brand_news_sources').select('kind, value, lang, active').eq('brand_id', brand.id);

  const sources = await Promise.all((rows ?? []).map(async (s) => {
    const kind = String(s.kind);
    const platform = sourceKindPlatform(kind);
    const allowedByPlan = isRadarKindAllowed(kind, brand.plan);
    const enabled = !platform || radarPlatformEnabled(prefs, platform, brand.plan);
    const base = { kind, value: s.value, active: s.active !== false, allowedByPlan, enabled, platform };
    if (!s.active || !allowedByPlan || !enabled) {
      return {
        ...base, items: 0,
        skipped: !s.active ? 'source is off' : !allowedByPlan ? `plan "${brand.plan ?? 'free'}" does not include this kind` : 'platform toggled off in Settings → Radar'
      };
    }
    try {
      const items = await fetchSourceFeed({ kind, value: String(s.value), lang: s.lang ?? null });
      return { ...base, items: items.length, windowHours: maxAgeHoursFor(kind), sample: items.slice(0, 3).map((i) => ({ title: i.title.slice(0, 120), url: i.url })) };
    } catch (e) {
      return { ...base, items: 0, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
    }
  }));

  return {
    enabled: prefs.enabled,
    plan: brand.plan ?? null,
    proLeads: hasProRadarLeads(brand.plan),
    scrapecreatorsConfigured: Boolean(env.SCRAPECREATORS_API_KEY),
    platforms: Object.fromEntries(RADAR_PLATFORM_KEYS.map((k) => [k, radarPlatformEnabled(prefs, k, brand.plan)])),
    engagePlatforms: leadEngagePlatforms(brand.plan),
    sources,
    // The dynamic keyword searches are not probed here: they cost a scraping credit each and are
    // already recorded per scan in radar_searches (marked `dynamic`).
    note: 'Dynamic keyword searches are reported per scan in radar_searches, not probed here.'
  };
}

// Fire the radar worker endpoint (best-effort — a dropped kick is recovered by the */2 cron
// backstop). Uses the same secret gate as the tick. The orchestrator calls this via waitUntil so
// Vercel keeps the function alive just long enough for the fetch to land.
export async function kickRadarWork(origin: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (env.AUTOPILOT_SECRET) headers['x-autopilot-secret'] = env.AUTOPILOT_SECRET;
  else if (env.CRON_SECRET) headers['authorization'] = `Bearer ${env.CRON_SECRET}`;
  await fetch(`${origin}/api/v1/radar/work`, { method: 'POST', headers }).catch(swallow('fetch failed'));
}

// Scan a brand's sources: read feeds from the DB cache (populated by the orchestrator's
// buildRadarFeedCache; refetches on miss/stale), dedupe against brand_news_items, judge the NEW
// items in one structured call grounded in the brand's strategy, persist verdicts. Returns the
// relevant items (top-relevance first), ready for radarProduce.
export async function radarScan(
  admin: SupabaseClient,
  brand: { id: string; name: string; timezone?: string | null; blog_config?: AnyRec | null; plan?: string | null },
  prefs: RadarPrefs
): Promise<RadarVerdictItem[]> {
  const t0 = Date.now();
  const { data: rawSources } = await admin
    .from('brand_news_sources').select('kind, value, lang').eq('brand_id', brand.id).eq('active', true);
  // Free/Starter: Reddit + Google News (+ RSS). Pro/scale: also Threads, X, LinkedIn.
  // Also honour Settings → Radar platform master toggles (default/generalist on/off).
  const sources = (rawSources ?? []).filter((s) => {
    const kind = String(s.kind);
    if (!isRadarKindAllowed(kind, brand.plan)) return false;
    const plat = sourceKindPlatform(kind);
    if (!plat) return true; // rss = custom-only, no master platform
    return radarPlatformEnabled(prefs, plat, brand.plan);
  });

  // Search history: one auditable row per scan (table radar_searches). We record every source
  // queried (configured feeds + the AI-generated Reddit queries) and the funnel found→fresh→
  // relevant→proposed. Best-effort: a logging failure never affects the scan.
  const searchLog: Array<{ kind: string; value: string; items: number; fromCache?: boolean; dynamic?: boolean; ok: boolean; error?: string }> = [];
  const logScan = async (c: { found: number; fresh: number; relevant: number; posts: number; comments: number; articles: number }) => {
    try {
      await admin.from('radar_searches').insert({
        brand_id: brand.id, mode: prefs.mode ?? null, sources: searchLog,
        items_found: c.found, items_fresh: c.fresh, items_relevant: c.relevant,
        posts_proposed: c.posts, comments_proposed: c.comments, articles_proposed: c.articles,
        ms: Date.now() - t0
      });
    } catch (error) { swallow('log radar scan telemetry', error); }
  };

  // Brand strategy context — loaded early so dynamic Reddit queries can use it. The community
  // profiles ride along: their vocabulary section is what lets the judge recognise someone
  // describing the problem in the words that community actually uses.
  const [{ data: kit }, gtmBrief, plan, communityProfiles] = await Promise.all([
    admin.from('brand_kit').select('about, category, target_audience, ai_context, content_pillars').eq('brand_id', brand.id).maybeSingle(),
    activeGtmBrief(admin, brand.id, brand.timezone || 'Europe/Rome').catch((error) => { swallow('load gtm brief', error); return ''; }),
    loadActivePlan(admin, brand.id).catch((error) => { swallow('load active plan', error); return null; }),
    loadCommunityProfiles(admin, brand.id).catch((error) => { swallow('load community profiles', error); return new Map(); })
  ]);
  const vocabulary = renderVocabularyDigest(communityProfiles);
  const weekIdx = plan ? currentWeekIndex(plan, brand.timezone || 'Europe/Rome') : null;
  const weekTheme = plan && weekIdx != null ? plan.weeks?.[weekIdx]?.theme ?? '' : '';

  const ai = genaiClient();

  // Static sources: read from shared DB cache; refetch stale/missing. Each item is tagged with
  // its ORIGIN source key so the fair-share round-robin below can give every source a slot.
  const fetched: Array<{ item: FeedItem; origin: string }> = [];
  if (sources?.length) {
    const since = new Date(Date.now() - FEED_CACHE_TTL_MS).toISOString();
    const keys = sources.map(sourceKey);
    const { data: cached } = await admin
      .from('radar_feed_cache').select('source_key, items').in('source_key', keys).gte('fetched_at', since);
    const byKey = new Map<string, FeedItem[]>(
      (cached ?? []).map((r) => [r.source_key as string, (r.items ?? []) as unknown as FeedItem[]])
    );
    const perSource = await Promise.all(sources.map(async (s) => {
      const origin = sourceKey(s);
      const tag = (items: FeedItem[]) => items.map((item) => ({ item, origin }));
      const hit = byKey.get(origin);
      if (hit) {
        searchLog.push({ kind: s.kind, value: s.value, items: hit.length, fromCache: true, ok: true });
        return tag(hit);
      }
      try {
        const items = await fetchSourceFeed(s);
        searchLog.push({ kind: s.kind, value: s.value, items: items.length, fromCache: false, ok: true });
        return tag(items);
      } catch (e) {
        // A single dead feed no longer aborts the whole scan — it's logged and skipped.
        searchLog.push({ kind: s.kind, value: s.value, items: 0, fromCache: false, ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) });
        return [];
      }
    }));
    fetched.push(...perSource.flat());
  }

  // User-defined lead criteria (radar prefs): how THIS brand wants leads found & recognised.
  // Injected into both the search-query generator and the relevance judge below.
  const leadCriteria = prefs.leadInstructions
    ? `\nUSER'S LEAD CRITERIA (authoritative — follow this to decide what counts as a lead for this brand):\n${prefs.leadInstructions}\n`
    : '';

  // Dynamic global search — AI generates contextual keywords each scan, then fans them out.
  // Go/Starter: Reddit only. Pro/scale: Reddit + Threads + LinkedIn. Plan-gated + Settings
  // platform toggles (no Zernio connect required). X has no global keyword-search endpoint
  // from our data provider (community-only), so it joins via stored sources.
  try {
    const pillars = Array.isArray(kit?.content_pillars) ? kit.content_pillars.join('; ') : '';
    const ctx = [kit?.about, kit?.category, pillars, weekTheme].filter(Boolean).join(' | ');
    if (ctx.length > 10) {
      const searchers: Array<{ kind: 'reddit_query' | 'threads_query' | 'linkedin_query'; prefix: string; run: (q: string) => Promise<RedditItem[]> }> = [];
      if (radarPlatformEnabled(prefs, 'reddit', brand.plan)) {
        searchers.push({ kind: 'reddit_query', prefix: 'rq', run: fetchRedditSearch });
      }
      if (radarPlatformEnabled(prefs, 'threads', brand.plan)) {
        searchers.push({ kind: 'threads_query', prefix: 'tq', run: fetchThreadsSearch });
      }
      if (radarPlatformEnabled(prefs, 'linkedin', brand.plan)) {
        searchers.push({ kind: 'linkedin_query', prefix: 'lq', run: fetchLinkedInSearch });
      }
      if (searchers.length) {
        const platformsLabel = searchers.map((s) => (s.kind === 'reddit_query' ? 'Reddit' : s.kind === 'threads_query' ? 'Threads' : 'LinkedIn')).join(', ');
        const dq = await aiStructured<{ queries: string[] }>(
          ai,
          `Generate 1-2 keyword search queries to find recent conversations (on ${platformsLabel}) where this brand can help with its expertise. Plain keywords, no boolean operators. Brand context: ${ctx.slice(0, 600)}${leadCriteria}`,
          { type: 'object' as const, properties: { queries: { type: 'array' as const, items: { type: 'string' as const } } }, required: ['queries'] },
          'You are a search query generator. Return only queries that would find real discussions where a brand expert could contribute.',
          'return_reddit_dynamic_queries'
        );
        const dqResults = await Promise.all((dq.queries ?? []).flatMap((q) =>
          searchers.map(async ({ kind, prefix, run }) => {
            try {
              const items = withinWindow(kind, await run(q));
              searchLog.push({ kind, value: q, items: items.length, dynamic: true, ok: true });
              return items.map((item) => ({ item, origin: `${prefix}:${q}` }));
            } catch (e) {
              searchLog.push({ kind, value: q, items: 0, dynamic: true, ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) });
              return [];
            }
          })
        ));
        fetched.push(...dqResults.flat());
      }
    }
  } catch (e) {
    console.warn('[radar] dynamic global queries failed:', e instanceof Error ? e.message.slice(0, 100) : e);
  }

  if (!fetched.length) {
    await logScan({ found: 0, fresh: 0, relevant: 0, posts: 0, comments: 0, articles: 0 });
    return [];
  }

  // Dedupe by url hash against everything this brand has already seen (keep the first origin).
  // Normalize Reddit hosts first so old.reddit.com / relative /r/… collapse onto the same www URL.
  const seen = new Map<string, { item: FeedItem; origin: string }>();
  for (const { item, origin } of fetched) {
    const url = /reddit\.com/i.test(item.url) || item.url.startsWith('/r/') ? normalizeRedditUrl(item.url) : item.url;
    const normalized = { ...item, url };
    const h = createHash('sha1').update(normalized.url).digest('hex').slice(0, 16);
    if (!seen.has(h)) seen.set(h, { item: normalized, origin });
  }
  const hashes = [...seen.keys()];
  const { data: existing } = await admin
    .from('brand_news_items').select('url_hash').eq('brand_id', brand.id).in('url_hash', hashes);
  const known = new Set((existing ?? []).map((r) => r.url_hash as string));

  // FAIR SHARE across sources. The old `.slice(0, MAX_ITEMS_PER_SCAN)` took the first 40 unseen
  // items in FETCH ORDER, so high-volume sources listed first (the Google News queries) filled
  // the budget every scan and permanently starved the subreddits listed after them (anomalia:
  // only 3 of 15 subs ever produced a single item). Round-robin one item per origin per pass so
  // every source that has fresh content contributes to the judged set.
  const queues = new Map<string, Array<[string, FeedItem]>>();
  for (const [h, { item, origin }] of seen) {
    if (known.has(h)) continue;
    let q = queues.get(origin);
    if (!q) { q = []; queues.set(origin, q); }
    q.push([h, item]);
  }
  const fresh = roundRobin(queues, MAX_ITEMS_PER_SCAN);
  if (!fresh.length) {
    await logScan({ found: seen.size, fresh: 0, relevant: 0, posts: 0, comments: 0, articles: 0 });
    return [];
  }

  const { data: inserted } = await admin
    .from('brand_news_items')
    .insert(fresh.map(([h, it]) => ({
      brand_id: brand.id, url_hash: h, url: it.url, title: it.title.slice(0, 300),
      snippet: it.snippet || null, source_name: it.sourceName || null, published_at: it.publishedAt
    })))
    .select('id, url_hash');
  const idByHash = new Map((inserted ?? []).map((r) => [r.url_hash as string, r.id as string]));

  // Comment/DM leads are a plan entitlement (pricing leadSources) — no Zernio connect required.
  // Also honour Settings → Radar platform master toggles (disabled platform → no comment drafts).
  // Anomalia only drafts; the human pastes. Go/Starter: Reddit. Pro: Reddit + Threads + X + LinkedIn.
  const engagePlatforms = leadEngagePlatforms(brand.plan).filter((p) =>
    radarPlatformEnabled(prefs, p as RadarPlatformKey, brand.plan)
  );
  const engageAllowed = new Set(engagePlatforms);

  // Blog article eligibility: only when the brand has an active blog. Without it, the AI must never
  // propose 'article' (a draft with nowhere to publish is dead weight).
  const blogEnabled = brand.blog_config?.enabled === true;

  const itemLines = fresh.map(([, it], i) => {
    const reddit = it.sourceName.startsWith('r/') ? ` · RISING REDDIT thread, ${Math.max(0, Math.round((Date.now() / 1000 - ((it as RedditItem).createdUtc || 0)) / 3600))}h old` : '';
    return `${i}. [${it.sourceName || '?'}${it.publishedAt ? ` · ${it.publishedAt.slice(0, 10)}` : ''}${reddit}] ${it.title}${it.snippet ? ` — ${it.snippet.slice(0, 180)}` : ''}`;
  }).join('\n');
  const prompt = `You are this brand's press office, scanning today's news for INSTANT-MARKETING opportunities: items the brand should visibly react to with a social post, in its voice, serving its strategy.

Brand: ${brand.name}
About: ${String(kit?.about ?? '').slice(0, 400)}
Category: ${kit?.category ?? ''} · Audience: ${kit?.target_audience ?? ''}
Content pillars: ${Array.isArray(kit?.content_pillars) ? kit?.content_pillars.join('; ') : ''}
${kit?.ai_context ? `BRAND CONTEXT (voice + strategy — judge relevance against THIS):\n${String(kit.ai_context).slice(0, 1800)}\n` : ''}${gtmBrief ? `${gtmBrief}\n` : ''}${weekTheme ? `This week's editorial theme: ${weekTheme}\n` : ''}${vocabulary ? `${vocabulary}\n` : ''}${leadCriteria}
NEWS ITEMS:
${itemLines}

Judge EVERY item. Be selective: a feed is mostly noise.${leadCriteria ? " The USER'S LEAD CRITERIA above OVERRIDE the generic rules below wherever they conflict — apply them strictly." : ''} THREE DIFFERENT RULERS:
- NEWS items → action 'post': relevant only when a post by THIS brand adds something to ITS feed (its expertise, its stance, its audience's stake). The SAME news may instead warrant 'article' when it has real DEPTH — a topic the brand can expand into a 1500+ word evergreen blog post from its expertise (analysis, guide, definitive take). Use 'article' ONLY for substantive items worth long-form treatment; use 'post' for quick reactions; most news is 'none'.
- CONVERSATIONS (Reddit threads, Threads posts, LinkedIn posts, X community tweets) → these are conversations to JOIN, not feed content: the thread's language or country does NOT matter (the reply gets written in its language) and feed-relevance rules do NOT apply. Action 'comment' is allowed on these PLAN lead platforms (no connected social account needed — Anomalia drafts, the human pastes): ${engagePlatforms.length ? engagePlatforms.join(', ') : '(none — NEVER use action comment)'} (reddit items = 'reddit', threads = 'threads', linkedin items = 'linkedin', x community = 'x'). Set 'comment' when the brand's documented expertise genuinely answers the conversation (support questions, parents seeking guidance, science/terminology questions are prime targets); relevance = how much the brand can actually help. Be STINGY with 'comment': only the day's best few get drafted, so reserve it for threads where the brand's reply would clearly be among the most useful there (relevance 70+) — merely on-topic is not enough. For platforms OUTSIDE the plan a strong conversation may still earn action 'post' (the brand reacts on its OWN feed). Skip drama, venting that needs peers not experts, and anything where a brand presence would feel intrusive.
${blogEnabled ? "- The brand's BLOG IS ACTIVE, so action 'article' is available for any news item (not conversations) that has enough substance for a long-form, evergreen blog post from the brand's expertise. Prefer 'article' over 'post' when the topic genuinely warrants depth (a full guide, analysis, or definitive take) rather than a quick social reaction.\n" : "- The brand's BLOG IS NOT ACTIVE — NEVER use action 'article'.\n"}
Duplicated stories: keep the best one, skip the rest ("duplicate"). Never invent facts beyond the title/snippet. ALL angles (post, comment, article) are user-facing rationale shown to the owner: write them in the BRAND'S language. Comment angles = one line on what the brand's reply should contribute (the reply itself gets drafted later in the THREAD'S language); article angles = the blog post's thesis in one line.`;

  const out = await aiStructured<{ verdicts?: AnyRec[] }>(ai, prompt, VERDICT_SCHEMA, 'You are a sharp press-review editor. Selective, strategic, never sensationalist for its own sake.', 'return_radar_verdicts');

  const results: RadarVerdictItem[] = [];
  for (const v of out.verdicts ?? []) {
    const i = Number(v?.index);
    const entry = fresh[i];
    if (!entry) continue;
    const [h, it] = entry;
    const id = idByHash.get(h);
    const relevant = v?.relevant === true && Number(v?.relevance) >= 50 && v?.urgency !== 'none' && v?.action !== 'none';
    const intent = normalizeIntent(v?.intent);
    await admin.from('brand_news_items').update({
      status: relevant ? 'proposed' : 'skipped',
      relevance: Math.max(0, Math.min(100, Number(v?.relevance) || 0)),
      angle: relevant ? String(v?.angle ?? '') : null,
      urgency: relevant ? String(v?.urgency ?? 'timely') : null,
      intent: relevant ? intent : null,
      skip_reason: relevant ? null : String(v?.skip_reason ?? '').slice(0, 300) || null
    }).eq('id', id ?? '');
    if (relevant && id) {
      // Hard-enforce plan engage allowlist — don't trust the model alone on 'comment'.
      let action: RadarVerdictItem['action'] =
        v.action === 'comment' ? 'comment' : v.action === 'article' ? 'article' : 'post';
      if (action === 'comment') {
        const plat = engagePlatformOf(it.url, it.sourceName);
        if (!plat || !engageAllowed.has(plat)) action = 'post';
      }
      results.push({
        id, url: it.url, title: it.title, snippet: it.snippet, sourceName: it.sourceName,
        relevance: Number(v.relevance) || 0, angle: String(v.angle ?? ''),
        urgency: v.urgency === 'breaking' ? 'breaking' : 'timely', pillar: String(v.pillar ?? ''),
        action,
        intent
      });
    }
  }

  // All relevant items, best first. Caps are applied by the CALLER per action (posts and articles
  // have a daily budget; comment suggestions have none), so they never eat each other's quota.
  // Best first: a person actively shopping outranks a slightly more on-topic thread where nobody
  // is buying. Relevance only breaks ties inside the same intent band.
  let picked = results.sort((a, b) => INTENT_RANK[b.intent] - INTENT_RANK[a.intent] || b.relevance - a.relevance);
  if (prefs.mode === 'breaking') picked = picked.filter((r) => r.urgency === 'breaking' || r.action === 'comment' || r.action === 'article');

  await logScan({
    found: seen.size,
    fresh: fresh.length,
    relevant: results.length,
    posts: picked.filter((p) => p.action === 'post').length,
    comments: picked.filter((p) => p.action === 'comment').length,
    articles: picked.filter((p) => p.action === 'article').length
  });
  return picked;
}

// ── Engage: draft a Reddit comment for the human to post (Anomalia NEVER touches Reddit) ────────────

// "Pochi ma buoni": il proprietario non riusciva a stare dietro a 6-8 bozze di commento al
// giorno. Due leve: una soglia di rilevanza più alta dei post (sotto, un commento consuma
// attenzione senza rendere) e un budget giornaliero pari a maxPerDay (stesso numero 1-3 di
// content_prefs.radar). Il cap significa "gli N MIGLIORI del giorno": prima si ordina per
// punteggio, poi si taglia — mai first-come.
export const COMMENT_MIN_RELEVANCE = 70;

/** I migliori N commenti: soglia, poi ordine per intent e rilevanza, poi taglio al budget. */
export function selectTopComments<T extends { action: string; relevance: number; intent: LeadIntent }>(
  picked: T[],
  budget: number
): T[] {
  return picked
    .filter((p) => p.action === 'comment' && p.relevance >= COMMENT_MIN_RELEVANCE)
    // Riordinato qui dentro (anche se il chiamante già ordina): la semantica "i migliori, non i
    // primi" non deve dipendere dall'ordine di arrivo.
    .sort((a, b) => INTENT_RANK[b.intent] - INTENT_RANK[a.intent] || b.relevance - a.relevance)
    .slice(0, Math.max(0, budget));
}

// Daily cap on radar-generated blog articles. Long-form takes AI time + owner review attention.
const ARTICLES_PER_DAY = 1;

const COMMENT_SCHEMA = {
  type: 'object' as const,
  properties: {
    worth_it: { type: 'boolean' as const, description: 'false if, seeing the full thread, a brand comment would NOT genuinely help — better silence than noise.' },
    comment: { type: 'string' as const, description: "The ready-to-paste comment, in the thread's language and Reddit's register." },
    dm: { type: 'string' as const, description: "A short, PERSONAL 1:1 direct message to the POST AUTHOR — ONLY when there is genuine 1:1 value (they're explicitly seeking a solution the brand actually offers). Softer and warmer than the public comment: open by referencing THEIR specific post, be helpful first, never a hard sell or a pitch. Bring in the brand either as an insider (with a light affiliation disclosure) or as a neutral tip ('you could check e.g. https://domain.com') — no need to declare you're the founder. When you point to the site, use the full https:// URL. Empty string when a DM would feel intrusive or spammy (default to empty unless the fit is obvious). Same language as the thread. 30-90 words." }
  },
  required: ['worth_it', 'comment', 'dm']
};

// ── Il prompt del drafter, estratto in funzione pura per i test ────────────────────────────────
// I guard-rail qui dentro rispondono ai modi in cui le bozze fallivano DAVVERO nell'uso reale:
// risposta nella lingua del brand invece che del thread, aperture di cortesia vuote, risposta al
// titolo invece che alla domanda nel corpo, pitch non richiesto, e commenti che ripetevano quello
// che i top comment avevano già detto.
export type EngagePromptArgs = {
  brandName: string;
  about: string;
  siteUrl: string;
  aiContext: string;
  sourceName: string;
  title: string;
  body: string;
  topComments: string;
  author: string;
  intent: LeadIntent;
  profileBlock: string;
  toneHint: string;
  styleHint: string;
  // Ultime riscritture dell'utente (prima→dopo): il segnale più onesto su cosa correggere.
  editPairs?: Array<{ before: string; after: string; feedback?: string }>;
};

export function buildEngagePrompt(a: EngagePromptArgs): string {
  const editBlock = a.editPairs?.length
    ? `\nHOW THE OWNER REWRITES YOUR DRAFTS (real before → after edits on this brand's recent drafts — absorb the DIFFERENCE: what they cut, the length, the tone. Apply the same taste to THIS draft; never reuse their wording, it belongs to other threads):\n${a.editPairs
        .map((p, i) => `${i + 1}. BEFORE: ${p.before}\n   AFTER: ${p.after}${p.feedback ? `\n   (owner's note: ${p.feedback})` : ''}`)
        .join('\n')}\n`
    : '';
  return `A conversation on ${a.sourceName} is rising and this brand's expertise is relevant. Draft the ONE reply the brand should post — as a knowledgeable community member, not a marketer.

REPLY LANGUAGE — ABSOLUTE RULE: write the comment AND the DM in the language of the THREAD (detect it from the thread's title and body below). The brand's language, the language of these instructions and of any style or voice material are IRRELEVANT to this choice: an English thread gets an English reply even when the brand writes its posts in Italian, and vice versa. Style instructions shape style, never language.

Brand: ${a.brandName} — ${a.about}
${a.siteUrl ? `Brand site (link it with the FULL URL exactly like this, never just the name or a bare domain): ${a.siteUrl}\n` : ''}${a.aiContext ? `Voice & expertise:\n${a.aiContext}\n` : ''}
THREAD "${a.title}":
${a.body || '(no body — title only)'}
${a.topComments ? `\nTOP COMMENTS ALREADY THERE (this is what the thread ALREADY has — never restate it):\n${a.topComments}` : ''}
${a.author ? `\nPOST AUTHOR: ${a.author} (the person you would DM 1:1).` : ''}
BUYER INTENT: ${a.intent} — 'seeking_now'/'comparing' means they asked for a solution, so naming one is welcome; 'researching' wants the explanation, not a product; 'venting' wants to be heard, so help without pointing anywhere and leave the DM empty.
${a.profileBlock ? `\n${a.profileBlock}\n` : ''}${a.toneHint}${a.styleHint}
${editBlock}
Produce TWO things: (1) the public COMMENT for the thread, and (2) a private DM to the post author — but ONLY draft a DM when there's a clear 1:1 fit (they explicitly want a solution the brand offers). If a DM would be intrusive, return an empty dm.

HARD RULES (survival + Italian hidden-advertising law):
- ANSWER THE ACTUAL QUESTION: the title is a headline; the real ask (their constraints, budget, what they already tried) lives in the body. When body and title diverge, answer the body.
- NO FILLER OPENERS: never start with "Great question", "Interesting point", or a restatement of their post. The first sentence already carries the substance.
- ADD VALUE BEYOND THE THREAD: when a top comment above already gives the core advice, do not repeat it — acknowledge it in passing ("someone already mentioned X") and contribute the piece it misses: a nuance, a trade-off, a concrete next step. If you have nothing beyond what's already there, set worth_it=false — better silence than an echo.
- WRITE FOR THE ROOM: when a COMMUNITY PROFILE is above, it wins over generic instinct — use the exact words from its vocabulary line, respect its rules line (what gets removed), and match the shape its tone line describes. Do not repeat advice its "already tried" line says they were burned by.
- VALUE FIRST: actually answer the thread with the brand's real expertise.
- NO UNSOLICITED PITCH: mention the brand ONLY when the buyer intent above says they asked for a solution (seeking_now/comparing) or the thread explicitly asks for recommendations. For 'researching' and 'venting', help without pointing anywhere.
- NEVER PROMISE WHAT IS NOT THERE: describe only what the brand context above actually says the product does. If the thread needs something it does not do, say so plainly or say nothing — an overpromise in public costs more than a missed lead.
- TWO WAYS to bring in the brand — pick whichever fits the thread naturally:
  (a) INSIDER: speak as someone who works on it, with an explicit disclosure ("Disclosure: I work on X" / "Trasparenza: ci lavoro io"). Use when a first-person "we built this" is the honest framing.
  (b) NEUTRAL TIP: recommend it as ONE example/resource among options, third person, no founder claim ("you could check e.g. ${a.siteUrl || 'the site'}"). Use for broadly-useful advice where naming yourself would feel heavy. Never pose as an unaffiliated fan hyping it — a neutral pointer is fine, a disguised hard sell is not.
  You do NOT have to say "I'm the founder" every time; mention the brand ONLY when it genuinely answers the question.
- When you DO point to the brand, write the WEBSITE as the full URL${a.siteUrl ? ` (${a.siteUrl})` : ''} — never just the name, never a bare domain without https://.
- PLATFORM REGISTER: Reddit → plain, first person, no hashtags; Threads → conversational, like talking to a friend; X → ONE sharp reply under 280 characters. Never marketing phrasing or emoji spam.
- COMMENT: 60-150 words. DM: 30-90 words, warmer and personal, opens by referencing THEIR post, helpful-not-salesy — empty when a cold DM would feel spammy.`;
}

export type RadarEngageRow = { title: string; url: string; sourceName: string; comment: string; dm: string; dmTarget: string; dmProfileUrl: string };

// Canonical https:// origin of the brand site, so replies can link the full URL (never a bare
// name or domain). Accepts "dominio.com", "http://www.dominio.com/", etc. → "https://dominio.com".
function normalizeSiteUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    return `https://${new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '')}`;
  } catch {
    return '';
  }
}

// Build the author's profile/DM URL per platform (the human opens it to send the DM manually).
function authorProfileUrl(url: string, author: string): string {
  if (!author) return '';
  if (url.includes('threads.net')) return `https://www.threads.net/@${author.replace(/^@/, '')}`;
  if (url.includes('x.com') || url.includes('twitter.com')) return `https://x.com/${author.replace(/^@/, '')}`;
  // LinkedIn authors are display names, not handles → no derivable profile URL; open the post itself.
  if (url.includes('linkedin.com')) return url;
  return `https://www.reddit.com/user/${author.replace(/^u\//, '')}`;
}

// For each picked Reddit thread: fetch the FULL thread (public read-only .json — post body + top
// comments), draft one genuinely useful comment in the brand's voice, store it on the item
// (status 'suggested'). The user copies it and comments manually with their own account.
export async function radarEngage(
  admin: SupabaseClient,
  brand: AnyRec,
  items: RadarVerdictItem[],
  prefs?: RadarPrefs
): Promise<RadarEngageRow[]> {
  if (!items.length) return [];
  const [{ data: kit }, { data: brandRow }, profiles] = await Promise.all([
    admin.from('brand_kit').select('about, ai_context').eq('brand_id', brand.id).maybeSingle(),
    admin.from('brands').select('website').eq('id', brand.id).maybeSingle(),
    loadCommunityProfiles(admin, brand.id).catch((error) => { swallow('load community profiles', error); return new Map(); })
  ]);
  // The full https:// URL to point people to (never just the name or a bare domain).
  const siteUrl = normalizeSiteUrl(brand.website ?? brandRow?.website);
  const ai = genaiClient();
  const out: RadarEngageRow[] = [];

  for (const it of items) {
    try {
      // Full thread context: ScrapeCreators first (post body + comments, same key as everything
      // else), then — for Reddit only — the official API, then RSS.
      let postBody = '';
      let topComments = '';
      let author = '';
      const isThreads = it.url.includes('threads.net');
      const isX = it.url.includes('x.com') || it.url.includes('twitter.com');
      const isLinkedIn = it.url.includes('linkedin.com');
      const isReddit = !isThreads && !isX && !isLinkedIn;
      try {
        if (isLinkedIn) {
          // The search already returned the post's full text in `snippet` — no comment API for
          // LinkedIn, so draft off the post body itself (author rides in sourceName).
          postBody = String(it.snippet || it.title || '');
          author = it.sourceName.replace(/^linkedin\s*·?\s*/, '');
        } else if (isThreads) {
          const t = await scrapeCreatorsGet(`/v1/threads/post?url=${encodeURIComponent(it.url)}&trim=true`);
          postBody = String(t?.post?.caption?.text ?? t?.caption?.text ?? it.snippet ?? '');
          author = String(t?.post?.user?.username ?? it.url.match(/@([^/]+)/)?.[1] ?? '');
          const cs: AnyRec[] = Array.isArray(t?.comments) ? t.comments : Array.isArray(t?.replies) ? t.replies : [];
          topComments = cs.slice(0, 5).map((c) => `- ${String(c?.caption?.text ?? c?.text ?? '').replace(/\s+/g, ' ').slice(0, 220)}`).filter((l) => l.length > 4).join('\n');
        } else if (isX) {
          const t = await scrapeCreatorsGet(`/v1/twitter/tweet?url=${encodeURIComponent(it.url)}&trim=true`);
          postBody = String(t?.full_text ?? t?.text ?? t?.tweet?.full_text ?? it.snippet ?? '');
          author = String(t?.user?.screen_name ?? t?.tweet?.user?.screen_name ?? it.url.match(/(?:x|twitter)\.com\/([^/]+)/)?.[1] ?? '');
        } else {
          const t = await scrapeCreatorsGet(`/v1/reddit/post/comments?url=${encodeURIComponent(it.url)}&trim=true`);
          postBody = String(t?.post?.selftext ?? t?.post?.title ?? '');
          author = String(t?.post?.author ?? '');
          const cs: AnyRec[] = Array.isArray(t?.comments) ? t.comments : [];
          topComments = cs.slice(0, 5)
            .map((c) => `- ${String(c?.body ?? '').replace(/\s+/g, ' ').slice(0, 220)}`)
            .filter((l) => l.length > 4)
            .join('\n');
        }
      } catch (e) {
        console.warn('[radar] thread fetch failed:', e instanceof Error ? e.message.slice(0, 120) : e);
      }

      // Reddit-only fallbacks, and ONLY when the primary came back empty. This block used to run
      // for EVERY platform whenever the official API returned nothing: it fetched
      // <threads|x|linkedin url>/.rss, got nothing back, and then overwrote the body and the top
      // comments ScrapeCreators had just returned with the empty result.
      if (isReddit && !postBody) {
        const thread = (await redditGet(`${new URL(it.url).pathname}?limit=8`)) as AnyRec[] | null;
        if (thread) {
          postBody = String(thread?.[0]?.data?.children?.[0]?.data?.selftext ?? '');
          author = author || String(thread?.[0]?.data?.children?.[0]?.data?.author ?? '');
          topComments = ((thread?.[1]?.data?.children ?? []) as AnyRec[])
            .map((c) => String(c?.data?.body ?? '')).filter(Boolean).slice(0, 5)
            .map((b) => `- ${b.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
        } else {
          const xml = await fetchRedditText(redditRssAuth(`${it.url.replace(/\/$/, '').replace('://www.', '://old.')}/.rss`));
          const entries = xml ? parseFeed(xml) : [];
          postBody = entries[0]?.snippet ?? '';
          topComments = entries.slice(1, 6)
            .map((e) => `- ${e.snippet.replace(/\s+/g, ' ').slice(0, 220)}`)
            .filter((l) => l.length > 4)
            .join('\n');
        }
      }

      // What we know about the room this reply is going into: their words, what they already
      // tried, what gets removed. Empty until the nightly profile pass has enough evidence.
      const key = communityKeyOf(it.sourceName, it.url);
      const profileBlock = key ? renderCommunityProfile(profiles.get(profileKey(key))) : '';

      const toneHint = prefs?.replyTone ? `\nTONE: Write in a ${prefs.replyTone} tone.` : '';
      const styleHint = prefs?.replyStyle ? `\nSTYLE INSTRUCTIONS (PRIORITY — override any conflicting rules below): ${prefs.replyStyle}` : '';

      const draft = await aiStructured<{ worth_it?: boolean; comment?: string; dm?: string }>(
        ai,
        buildEngagePrompt({
          brandName: String(brand.name ?? ''),
          about: String(kit?.about ?? '').slice(0, 800),
          siteUrl,
          aiContext: kit?.ai_context ? String(kit.ai_context).slice(0, 2500) : '',
          sourceName: it.sourceName,
          title: it.title,
          body: (postBody || it.snippet || '').slice(0, 1500),
          topComments,
          author,
          intent: it.intent,
          profileBlock,
          toneHint,
          styleHint,
          // Ultime 3 riscritture: bastano a dare la direzione senza gonfiare il prompt.
          editPairs: prefs?.editPairs?.slice(-3)
        }),
        COMMENT_SCHEMA,
        'You write Reddit comments that earn upvotes because they help. You would rather say nothing than sound like an ad.',
        'return_reddit_comment'
      );

      const comment = String(draft?.comment ?? '').trim();
      if (draft?.worth_it !== true || !comment) {
        await admin.from('brand_news_items').update({ status: 'skipped', skip_reason: 'engage: nothing genuinely useful to add' }).eq('id', it.id);
        continue;
      }
      const dm = String(draft?.dm ?? '').trim();
      const dmProfileUrl = dm ? authorProfileUrl(it.url, author) : '';
      await admin.from('brand_news_items').update({ status: 'suggested', suggestion: comment, dm_draft: dm || null, dm_target: author || null }).eq('id', it.id);
      out.push({ title: it.title, url: it.url, sourceName: it.sourceName, comment, dm, dmTarget: author, dmProfileUrl });
    } catch (e) {
      console.error('[radar] engage failed for item:', e instanceof Error ? e.message : e);
    }
  }
  return out;
}

// ── Produce: item → seed → the existing machine → pending_user post + digest email ─────────────

// Pending-backlog cap: a deep queue of stale pending_user posts (over the cap, each older than a
// week) means the approval gate — not the generator — is the bottleneck. Producing more radar
// posts would only deepen the pile, so radar skips THIS tick's post production only; engage
// comment/DM suggestions and blog article drafts still run. Same gate the scheduler applies to the
// weekly autopilot (PENDING_BACKLOG_CAP in scheduler.ts).
export const RADAR_PENDING_BACKLOG_CAP = 15;
const RADAR_PENDING_BACKLOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True when the brand's pending_user queue is over the cap with posts older than 7 days. When it
 * trips, writes one `radar_backlog` incident per day — dedup brand_id+kind+detected_on, and
 * detected_on is GENERATED ALWAYS (migration 0084) so it never rides in the payload (sending it
 * fails the upsert with 428C9 and silently loses the incident). Logs the skip. Read-only when the
 * queue is healthy.
 */
export async function radarBacklogExceeded(
  admin: SupabaseClient,
  brandId: string,
  brandSlug?: string
): Promise<boolean> {
  const { count: pendingBacklog } = await admin
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('status', 'pending_user')
    .lt('created_at', new Date(Date.now() - RADAR_PENDING_BACKLOG_AGE_MS).toISOString());
  if ((pendingBacklog ?? 0) > RADAR_PENDING_BACKLOG_CAP) {
    await admin.from('incidents').upsert(
      {
        brand_id: brandId,
        kind: 'radar_backlog',
        severity: 'warning',
        details: { pending: pendingBacklog ?? 0, olderThanDays: 7 }
      },
      { onConflict: 'brand_id,kind,detected_on' }
    );
    console.warn(
      `[radar] ${brandSlug ?? brandId}: ${pendingBacklog} pending_user posts older than 7d (cap ${RADAR_PENDING_BACKLOG_CAP}) — radar post production skipped this tick.`
    );
    return true;
  }
  return false;
}

// Assemble the planner profile from stored data (mirrors the autopilot's builder in scheduler.ts).
async function loadRadarProfile(admin: SupabaseClient, brand: AnyRec): Promise<AnyRec> {
  const [{ data: kit }, { data: rawProducts }] = await Promise.all([
    admin.from('brand_kit')
      .select('category, about, target_audience, brand_colors, ai_character, ai_context, visual_style, site_type, content_pillars, logos, fonts, theme_color')
      .eq('brand_id', brand.id).maybeSingle(),
    admin.from('products').select('title, description, kind, pricing, images').eq('brand_id', brand.id)
  ]);
  const profile: AnyRec = {
    name: brand.name,
    category: kit?.category ?? '', about: kit?.about ?? '', target_audience: kit?.target_audience ?? '',
    brand_colors: kit?.brand_colors ?? [], ai_character: kit?.ai_character ?? {},
    ai_context: kit?.ai_context ?? '', visual_style: kit?.visual_style ?? '',
    site_type: kit?.site_type ?? 'generic', content_pillars: kit?.content_pillars ?? [],
    logos: kit?.logos ?? [], fonts: kit?.fonts ?? [], theme_color: kit?.theme_color ?? null,
    products: selectFeaturableProducts(rawProducts ?? [], 40).map((p) => ({ name: p.title, description: p.description, kind: p.kind, pricing: p.pricing, images: p.images }))
  };
  await attachBrandPeople(profile, admin, brand.id);
  await attachBrandMoodImages(profile, admin, brand.id);
  await attachBrandPages(profile, admin, brand.id).catch(swallow('attach brand pages'));
  await enrichProfileWithMemory(admin, brand.id, profile);
  return profile;
}

const ARTICLE_EXCERPT_CHARS = 1200;

// Produce ONE pending_user post per picked item, through the full existing machine (copywriter →
// copy chief → medium-locked render → QC → Director). The article's real text is fetched and
// carried in the seed's angle so the writer works from FACTS and the chief can verify claims.
export async function radarProduce(
  admin: SupabaseClient,
  brand: AnyRec,
  items: RadarVerdictItem[]
): Promise<{ postsCreated: number; flagged: number; emailRows: Array<{ title: string; caption: string; imageUrl: string | null; sourceUrl: string; approveToken: string; rejectToken: string }> }> {
  if (!items.length) return { postsCreated: 0, flagged: 0, emailRows: [] };
  // Pending-backlog cap: a stale pending_user queue means the approval gate is the bottleneck —
  // skip NEW post creation for this tick (the caller still runs engage suggestions and article
  // drafts). Checked before any profile load / AI work, so a blocked brand costs nothing.
  if (await radarBacklogExceeded(admin, String(brand.id), brand.slug ?? undefined)) {
    return { postsCreated: 0, flagged: 0, emailRows: [] };
  }
  const profile = await loadRadarProfile(admin, brand);
  const platforms: string[] = Array.isArray(brand.target_platforms) && brand.target_platforms.length ? brand.target_platforms : ['instagram'];
  const primary = platforms[0];
  const language = (brand.content_prefs?.language as string) || '';

  // Include connected short networks (X / Threads) in the seed platform set so the copywriter
  // authors platform_captions cuts AND the row is stored ready to cross-post. Without this,
  // Radar posts saved only `platform: instagram` with no cuts — approving them to X/Threads
  // then shipped the full IG caption and Zernio rejected it as over-limit.
  const { data: connectedRows } = await admin
    .from('social_accounts')
    .select('platform')
    .eq('brand_id', brand.id)
    .eq('status', 'active');
  const connected = new Set(
    (connectedRows ?? []).map((a) => String(a.platform ?? '').toLowerCase()).filter(Boolean)
  );
  const shortConnected = ALT_CAPTION_PLATFORMS.filter((p) => connected.has(p));
  const seedPlatforms = [...new Set([primary, ...shortConnected].filter(Boolean))];

  // Ground each seed in the article's REAL text (best-effort — Google News links redirect to the
  // publisher and fetchPage follows them SSRF-safely).
  const seeds = await Promise.all(items.map(async (it) => {
    const article = await fetchPage(it.url).catch(() => '');
    const excerpt = article
      ? article.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ARTICLE_EXCERPT_CHARS)
      : '';
    return {
      platform: primary,
      platforms: seedPlatforms,
      pillar: it.pillar || 'instant marketing',
      format: 'single_image' as const,
      media: 'image' as const,
      day: '', time: '',
      product: '', person: '',
      angle: `${it.angle} — SOURCE (${it.sourceName || 'news'}): "${it.title}". FACTS FROM THE ARTICLE (only claims supported here may appear in the caption): ${excerpt || it.snippet || '(no article text — stick strictly to the headline)'}`,
      subject: `editorial visual about: ${it.title.slice(0, 120)}`,
      setting: '', props: ''
    };
  }));

  const strategy = {
    theme: 'Instant marketing: react to today\'s news in the brand\'s voice',
    rationale: 'These posts anchor the brand to the live public debate it has authority on.',
    doDont: 'DO stick strictly to the facts carried in each seed. DO take the brand\'s stance. DON\'T invent numbers, names or outcomes not in the source facts.',
    seeds
  };

  const prefs = {
    language,
    ...((brand.content_prefs as ContentPrefs | null) ?? {}),
    // Language from radar locale wins over stale prefs when set.
    ...(language ? { language } : {})
  };
  const posts = await executeWeekStrategy(profile, strategy, prefs, 0, 0, {
    supabase: admin,
    brandId: brand.id,
    userId: brand.id
  });
  await renderPreviewImages(profile, posts, { supabase: admin, userId: brand.id, onProgress: () => {}, onPost: () => {} });

  // Skip Director when produce agent already approved (single quality gate).
  const director = isProduceApproved(posts)
    ? null
    : await runDirector({
        supabase: admin, userId: brand.id, brandId: brand.id, profile, posts,
        brief: `INSTANT-MARKETING BATCH: each post reacts to a real news item (source facts are in the seed angles). Verify the captions stay within the source facts; flag anything time-sensitive the owner should publish quickly.`
      }).catch((error) => { swallow('item failed', error); return null; });

  const { data: cp } = await admin.from('content_plans').insert({
    brand_id: brand.id,
    title: `Radar · ${new Date().toISOString().slice(0, 10)}`,
    source: 'radar',
    status: 'proposed',
    director_log: director ?? null
  }).select('id').single();

  let flagged = 0;
  const emailRows: Array<{ title: string; caption: string; imageUrl: string | null; sourceUrl: string; approveToken: string; rejectToken: string }> = [];
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i] as PreviewPost & AnyRec;
    const item = items[i];
    const attention = (post.__attention as string) || (item.urgency === 'breaking' ? 'Breaking news: valuta una pubblicazione immediata.' : null);
    if (attention) flagged++;
    const approvalToken = randomUUID();

    // Prefer the writer's authored platforms (seed may have added X/Threads); fall back to the
    // seed set we built above. Persist short-network cuts so approve → publish never ships the
    // full IG caption to X/Threads.
    const rowPlatforms = Array.isArray(post.platforms) && post.platforms.length
      ? post.platforms.map((p) => String(p).toLowerCase()).filter(Boolean)
      : seedPlatforms;
    const platformCaptions = ensureShortNetworkCuts(
      post.caption,
      rowPlatforms,
      post.platform_captions && Object.keys(post.platform_captions).length ? post.platform_captions : null
    );

    const { data: row } = await admin.from('posts').insert({
      brand_id: brand.id,
      plan_id: cp?.id ?? null,
      platform: String(post.platform ?? primary).toLowerCase() || primary,
      platforms: rowPlatforms.length > 1 ? rowPlatforms : null,
      format: post.format ?? null,
      content_type: post.media === 'text' ? 'text' : post.media === 'link' ? 'link' : 'generated_image',
      source: 'radar',
      caption: post.caption ?? null,
      title: post.title?.trim() || null,
      link_url: post.link_url || null,
      subreddit: post.subreddit?.trim() || null,
      image_prompt: post.image_prompt ?? null,
      media_url: post.imageUrl ?? null,
      pillar: post.pillar ?? null,
      status: 'pending_user',
      source_url: item.url,
      needs_attention: !!attention,
      attention_reason: attention,
      qc: postQcPayload(post),
      alt_captions: Array.isArray(post.alt_captions) && post.alt_captions.length ? post.alt_captions : null,
      platform_captions: platformCaptions,
      first_comment: post.first_comment?.trim() || null,
      hook_variants: Array.isArray(post.hook_variants) && post.hook_variants.length ? post.hook_variants : null,
      approval_token: approvalToken,
      approval_token_expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    }).select('id').single();
    if (row?.id) {
      // P2 visual metadata: deterministic, zero-cost snapshot derived from the persisted row,
      // written right after insert — best-effort, never blocks the post.
      try {
        const { writeVisualMeta } = await import('$lib/server/visual-meta');
        await writeVisualMeta(admin, brand.id, { ...post, id: row.id as string });
      } catch (e) {
        console.warn('[radar] writeVisualMeta', e instanceof Error ? e.message : e);
      }
      await admin.from('brand_news_items').update({ status: 'posted' }).eq('id', item.id);
      emailRows.push({ title: item.title, caption: String(post.caption ?? '').slice(0, 240), imageUrl: post.imageUrl ?? null, sourceUrl: item.url, approveToken: approvalToken, rejectToken: approvalToken });
      if (post.knowledgeChunkIds?.length) {
        try {
          const { recordChunkUsedByPost } = await import('$lib/server/knowledge');
          await recordChunkUsedByPost(admin, brand.id, row.id as string, post.knowledgeChunkIds);
        } catch (e) {
          console.warn('[radar] recordChunkUsedByPost', e instanceof Error ? e.message : e);
        }
      }
    }
  }

  return { postsCreated: emailRows.length, flagged, emailRows };
}

// ── The single digest email: proposed posts (one-click approve) + Reddit comment suggestions ────

type DigestPostRow = { title: string; caption: string; imageUrl: string | null; sourceUrl: string; approveToken: string; rejectToken: string };
type DigestCommentRow = { title: string; url: string; sourceName: string; comment: string; dm?: string; dmTarget?: string; dmProfileUrl?: string };
type DigestArticleRow = { title: string; articleId: string; sourceUrl: string };

// Esportata pura per i test: la mail DEVE portare la merce — il testo del commento pronto da
// copiare e il link diretto al thread — così il flusso è leggi mail → copia → apri thread →
// incolla, zero passaggi nell'app. I post prodotti hanno già i link firmati approva/scarta
// (approval_token persistito sulla riga); per i commenti niente bottoni-azione in mail: si copia
// e si incolla a mano, per scelta.
export function radarDigestHtml(
  it: boolean,
  appBase: string,
  posts: DigestPostRow[],
  comments: DigestCommentRow[],
  articles: DigestArticleRow[]
): string {
  const postBlocks = posts.map((r) => `
    <div style="border:1px solid #e5e5e5;border-radius:12px;padding:16px;margin:0 0 14px;">
      ${r.imageUrl ? `<img src="${r.imageUrl}" width="240" style="border-radius:8px;display:block;margin-bottom:10px;" />` : ''}
      <div style="font-size:13px;color:#666;margin-bottom:6px;">${it ? 'Notizia' : 'News'}: <a href="${r.sourceUrl}">${r.title}</a></div>
      <div style="font-size:14px;white-space:pre-wrap;margin-bottom:12px;">${r.caption}</div>
      <a href="${appBase}/api/radar/approve/${r.approveToken}" style="background:#111;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;margin-right:8px;">${it ? 'Approva' : 'Approve'}</a>
      <a href="${appBase}/api/radar/reject/${r.rejectToken}" style="color:#b00;text-decoration:none;">${it ? 'Scarta' : 'Reject'}</a>
    </div>`).join('');

  // Comment (+ optional DM) suggestions: copy-ready text + plain links — Anomalia NEVER posts or
  // DMs for you. You paste them and send from your own account.
  const commentBlocks = comments.map((c) => `
    <div style="border:1px solid #e5e5e5;border-radius:12px;padding:16px;margin:0 0 14px;">
      <div style="font-size:13px;color:#666;margin-bottom:6px;">${c.sourceName} · <a href="${c.url}">${c.title}</a></div>
      <div style="font-size:12px;font-weight:600;color:#888;margin-bottom:4px;">${it ? 'Commento' : 'Comment'}</div>
      <div style="font-size:14px;white-space:pre-wrap;background:#f6f6f6;border-radius:8px;padding:12px;margin-bottom:10px;">${c.comment}</div>
      <a href="${c.url}" style="background:#ff4500;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;">${it ? 'Apri e rispondi →' : 'Open and reply →'}</a>
      ${c.dm ? `
      <div style="font-size:12px;font-weight:600;color:#888;margin:16px 0 4px;">DM${c.dmTarget ? ` · ${c.dmTarget}` : ''}</div>
      <div style="font-size:14px;white-space:pre-wrap;background:#eef4ff;border-radius:8px;padding:12px;margin-bottom:10px;">${c.dm}</div>
      ${c.dmProfileUrl ? `<a href="${c.dmProfileUrl}" style="background:#111;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;">${it ? 'Apri profilo e invia DM →' : 'Open profile & DM →'}</a>` : ''}` : ''}
    </div>`).join('');

  const articleBlocks = articles.map((a) => `
    <div style="border:1px solid #e5e5e5;border-radius:12px;padding:16px;margin:0 0 14px;">
      <div style="font-size:13px;color:#666;margin-bottom:6px;">${it ? 'Articolo blog (bozza)' : 'Blog article (draft)'} · <a href="${a.sourceUrl}">${it ? 'fonte' : 'source'}</a></div>
      <div style="font-size:15px;font-weight:600;margin-bottom:10px;">${a.title}</div>
      <a href="${appBase}/blog-preview/${a.articleId}" style="background:#111;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;">${it ? 'Anteprima articolo →' : 'Preview article →'}</a>
    </div>`).join('');

  return `<div style="font-family:sans-serif;max-width:560px;">
    <h2 style="margin:0 0 4px;">📡 Radar</h2>
    ${posts.length ? `<p style="color:#555;margin:14px 0 10px;"><b>${it ? 'Post pronti (approva con un click)' : 'Posts ready (one-click approve)'}</b></p>${postBlocks}` : ''}
    ${articles.length ? `<p style="color:#555;margin:14px 0 10px;"><b>${it ? 'Articoli blog pronti da rivedere' : 'Blog articles ready to review'}</b></p>${articleBlocks}` : ''}
    ${comments.length ? `<p style="color:#555;margin:14px 0 10px;"><b>${it ? 'Conversazioni dove dire la tua — commento pronto da incollare (pubblichi tu, mai in automatico)' : 'Conversations worth joining — comment ready to paste (you post it, never automated)'}</b></p>${commentBlocks}` : ''}
  </div>`;
}

async function sendRadarDigest(admin: SupabaseClient, brand: AnyRec, posts: DigestPostRow[], comments: DigestCommentRow[], articles: DigestArticleRow[] = []): Promise<void> {
  if ((!posts.length && !comments.length && !articles.length) || !brand.org_id) return;
  try {
    const contacts = await brandContacts(admin, brand.org_id, brand.id);
    const appBase = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
    if (!contacts.length || !appBase) return;
    const radarUrl = `${appBase}/app/${brand.slug ?? ''}/radar`;
    // One digest per recipient (owner + collaborators), each in their own language.
    // Emails first; Web Push after (never fails the digest).
    for (const contact of contacts) {
      // Contatto senza locale → inglese, come tutte le notice: il vecchio `?? 'it'` mandava
      // un digest italiano a chi non lo aveva mai scelto.
      const it = bilingualNoticeLocale(contact.locale) === 'it';

      const total = posts.length + comments.length + articles.length;
      const subject = it ? `📡 Radar · ${brand.name}: ${total} ${total === 1 ? 'opportunità' : 'opportunità'} di oggi` : `📡 Radar · ${brand.name}: ${total} opportunit${total === 1 ? 'y' : 'ies'} today`;
      await sendEmail({
        to: contact.email,
        subject,
        html: radarDigestHtml(it, appBase, posts, comments, articles),
        text: [
          ...posts.map((r) => `${r.title}\n${r.sourceUrl}\n${r.caption}`),
          ...articles.map((a) => `${a.title} (draft)\n${appBase}/blog-preview/${a.articleId}`),
          ...comments.map((c) => `${c.title}\n${c.url}\nCOMMENT:\n${c.comment}${c.dm ? `\nDM${c.dmTarget ? ` (${c.dmTarget})` : ''}:\n${c.dm}${c.dmProfileUrl ? `\n${c.dmProfileUrl}` : ''}` : ''}`)
        ].join('\n---\n'),
        // This is the only Anomalia email meant to land in Gmail's Promotions tab: it's a recurring,
        // opt-outable digest of marketing opportunities. List-Unsubscribe + bulk precedence signal that.
        headers: {
          'List-Unsubscribe': `<${radarUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          Precedence: 'bulk'
        }
      }).catch((e) => console.error(`[radar] digest email to ${contact.email} failed:`, e instanceof Error ? e.message : e));
    }

    const { pushToBrandContacts } = await import('$lib/server/brand-notify');
    await pushToBrandContacts(admin, contacts, {
      url: radarUrl,
      tag: `radar-${brand.id}`,
      body: (locale) => {
        const it = locale === 'it';
        const total = posts.length + comments.length + articles.length;
        return it
          ? `Radar · ${brand.name}: ${total} opportunità di oggi`
          : `Radar · ${brand.name}: ${total} opportunit${total === 1 ? 'y' : 'ies'} today`;
      }
    });
  } catch (e) {
    console.error('[radar] digest email failed:', e instanceof Error ? e.message : e);
  }
}

// ── Articles: draft a blog article from a news item (only when the blog is active) ─────────────

// For each picked article item: generate a full blog article draft via the existing blog-generate
// pipeline, grounded in the brand's expertise. The draft lands as status='draft' with source='radar'
// and shows up in the daily recap. Returns how many articles were generated.
async function radarArticles(admin: SupabaseClient, brand: AnyRec, items: RadarVerdictItem[]): Promise<number> {
  let n = 0;
  for (const it of items) {
    try {
      const id = await generateBlogFromNews(admin, brand, { title: it.title, url: it.url, context: it.angle }, { skipNotify: true });
      if (id) {
        await admin.from('brand_news_items').update({ status: 'posted' }).eq('id', it.id);
        n++;
      }
    } catch (e) {
      console.error('[radar] article failed for item:', e instanceof Error ? e.message : e);
    }
  }
  return n;
}

// One brand's full radar pass: scan → split by action → produce posts (daily cap) + draft comments
// & DMs (weekly cap) + draft blog articles (daily cap, only if blog is active). Stores everything.
// Does NOT email — the digest is a SEPARATE daily recap (sendDailyRadarRecap), so scanning 4×/day
// still means one email/day. Never throws. Reads the shared feed cache from radar_feed_cache (DB).
// Credits: the radar crons (tick/work) call this outside any request scope, so the brand
// context for ai_calls attribution is established here.
export async function radarTickForBrand(admin: SupabaseClient, brand: AnyRec): Promise<{ scanned: boolean; postsCreated: number; commentsSuggested: number; articlesCreated: number }> {
  return withBrandContext(String(brand.id), () => radarTickForBrandInner(admin, brand));
}

async function radarTickForBrandInner(admin: SupabaseClient, brand: AnyRec): Promise<{ scanned: boolean; postsCreated: number; commentsSuggested: number; articlesCreated: number }> {
  try {
    // Credits gate: an exhausted brand skips its radar run entirely (clean skip, fail-open).
    {
      const { gateCredits, CreditsExhaustedError } = await import('./credits');
      try {
        await gateCredits(String(brand.id));
      } catch (e) {
        if (e instanceof CreditsExhaustedError) {
          console.warn(`[radar] brand ${brand.id} credits exhausted — skipping tick`);
          return { scanned: false, postsCreated: 0, commentsSuggested: 0, articlesCreated: 0 };
        }
        throw e;
      }
    }
    const prefs = radarPrefsOf(brand.content_prefs);
    if (!prefs.enabled) return { scanned: false, postsCreated: 0, commentsSuggested: 0, articlesCreated: 0 };
    // Marks the start of this run: in emailPerRun mode we email everything stored since here, so the
    // digest batches exactly this run's leads (created_at >= runStart) and nothing from earlier runs.
    const runStart = new Date().toISOString();
    const picked = await radarScan(admin, { id: String(brand.id), name: String(brand.name ?? ''), timezone: brand.timezone ?? null, blog_config: brand.blog_config, plan: brand.plan ?? null }, prefs);

    // Rebuild the stalest community profiles from everything collected so far (this scan included)
    // BEFORE drafting — the drafter reads them. Self-throttled: only communities with new evidence,
    // a few per run, so it stays one small call per community per day.
    await refreshCommunityProfiles(admin, { id: String(brand.id), name: String(brand.name ?? '') }).catch((error) => { swallow('String failed', error); return 0; });

    if (!picked.length) return { scanned: true, postsCreated: 0, commentsSuggested: 0, articlesCreated: 0 };

    // Daily post budget: with 3 ticks/day, maxPerDay must be enforced against what TODAY already
    // produced, not per scan.
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { count: postedToday } = await admin
      .from('posts').select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id).eq('source', 'radar').gte('created_at', dayStart.toISOString());
    const postBudget = Math.max(0, (prefs.maxPerDay ?? 1) - (postedToday ?? 0));
    const postItems = picked.filter((p) => p.action === 'post').slice(0, postBudget);

    // Budget giornaliero anche per i commenti (stesso maxPerDay dei post, contato a parte): con
    // più tick al giorno il cap va applicato contro quanto GIÀ suggerito oggi, e dentro il tick
    // vincono i punteggi, non l'ordine di arrivo (selectTopComments).
    const { count: suggestedToday } = await admin
      .from('brand_news_items').select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id).not('suggestion', 'is', null).gte('created_at', dayStart.toISOString());
    const commentItems = selectTopComments(picked, Math.max(0, (prefs.maxPerDay ?? 1) - (suggestedToday ?? 0)));

    // Daily article budget (1/day — long-form takes AI time and owner attention).
    const { count: articlesToday } = await admin
      .from('brand_articles').select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id).eq('source', 'radar').gte('created_at', dayStart.toISOString());
    const articleBudget = Math.max(0, ARTICLES_PER_DAY - (articlesToday ?? 0));
    const articleItems = picked.filter((p) => p.action === 'article').slice(0, articleBudget);

    const produced = postItems.length ? await radarProduce(admin, brand, postItems) : { postsCreated: 0, flagged: 0, emailRows: [] };
    const comments = commentItems.length ? await radarEngage(admin, brand, commentItems, prefs) : [];
    const articles = articleItems.length ? await radarArticles(admin, brand, articleItems) : 0;
    // Email cadence: default is silence here (the daily recap aggregates the day). In emailPerRun mode
    // we send this run's batch right away — but only if it produced something worth an email.
    if (prefs.emailPerRun && (produced.postsCreated || comments.length || articles)) {
      await sendRadarRecap(admin, brand, runStart);
    }
    return { scanned: true, postsCreated: produced.postsCreated, commentsSuggested: comments.length, articlesCreated: articles };
  } catch (e) {
    console.error(`[radar] tick failed for ${brand?.slug ?? brand?.id}:`, e instanceof Error ? e.message : e);
    return { scanned: false, postsCreated: 0, commentsSuggested: 0, articlesCreated: 0 };
  }
}

// DAILY recap: one digest email per brand aggregating everything the day's ticks produced —
// pending_user radar posts (approve/reject tokens are persisted on the row) + comment/DM
// suggestions stored on items. Decoupled from scanning so the radar can scan often without spamming.
// HOOK FUTURO (agent threads): quando team-ignition esporrà reportToAgentThread, il punto di
// aggancio è QUI, il momento del recap — gli stessi lead del giorno (post + commenti + articoli)
// vanno riportati anche nel thread dell'agente Radar, oltre che via email. Nessun plumbing di
// thread va costruito in questo file.
export async function sendDailyRadarRecap(admin: SupabaseClient, brand: AnyRec): Promise<boolean> {
  return sendRadarRecap(admin, brand, new Date(Date.now() - 24 * 3600 * 1000).toISOString());
}

// Query everything the radar stored for this brand since `sinceIso` and email it as one digest.
// Window = 24h for the daily cron, or this run's start for emailPerRun mode. No-ops (no email) when
// nothing was stored in the window.
async function sendRadarRecap(admin: SupabaseClient, brand: AnyRec, since: string): Promise<boolean> {
  try {
    if (!radarPrefsOf(brand.content_prefs).enabled) return false;
    const [{ data: posts }, { data: items }, { data: articles }] = await Promise.all([
      admin.from('posts').select('title, caption, media_url, source_url, approval_token')
        .eq('brand_id', brand.id).eq('source', 'radar').eq('status', 'pending_user').gte('created_at', since),
      admin.from('brand_news_items').select('title, url, source_name, suggestion, dm_draft, dm_target, relevance, intent')
        .eq('brand_id', brand.id).eq('status', 'suggested').gte('created_at', since).not('suggestion', 'is', null),
      admin.from('brand_articles').select('id, title, source_initiative_id')
        .eq('brand_id', brand.id).eq('source', 'radar').eq('status', 'draft').gte('created_at', since)
    ]);
    const postRows: DigestPostRow[] = (posts ?? []).map((p) => ({
      title: p.title || 'Notizia', caption: String(p.caption ?? '').slice(0, 240), imageUrl: p.media_url ?? null,
      sourceUrl: p.source_url ?? '', approveToken: p.approval_token ?? '', rejectToken: p.approval_token ?? ''
    }));
    const commentRows: DigestCommentRow[] = (items ?? [])
      // I migliori in cima alla mail: chi sta comprando prima di chi chiacchiera, poi rilevanza —
      // stesso metro con cui il tick ha scelto cosa bozzare.
      .sort((a, b) =>
        (INTENT_RANK[normalizeIntent(b.intent)] ?? 0) - (INTENT_RANK[normalizeIntent(a.intent)] ?? 0) ||
        (Number(b.relevance) || 0) - (Number(a.relevance) || 0))
      .map((i) => ({
        title: i.title ?? '', url: i.url ?? '', sourceName: i.source_name ?? '', comment: i.suggestion ?? '',
        dm: i.dm_draft ?? '', dmTarget: i.dm_target ?? '', dmProfileUrl: i.dm_draft ? authorProfileUrl(i.url ?? '', i.dm_target ?? '') : ''
      }));
    const articleRows: DigestArticleRow[] = (articles ?? []).map((a) => ({
      title: a.title ?? 'Articolo', articleId: a.id, sourceUrl: a.source_initiative_id ?? ''
    }));
    if (!postRows.length && !commentRows.length && !articleRows.length) return false;
    await sendRadarDigest(admin, brand, postRows, commentRows, articleRows);
    return true;
  } catch (e) {
    console.error(`[radar] recap failed for ${brand?.slug ?? brand?.id}:`, e instanceof Error ? e.message : e);
    return false;
  }
}
