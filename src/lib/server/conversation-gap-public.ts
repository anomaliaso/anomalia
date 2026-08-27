// Public (unauthenticated) conversation-gap estimator for /tools/conversation-gap.
//
// Answers: “how much relevant conversation are you missing around what you already sell?”
// Pipeline: fetch site → strip branded demand → AI finds how people discuss the same problem
// on forums/social → DataForSEO volumes for those phrasings → monthly range + gap vs cadence.
//
// The free UI shows only the range + score + confidence. Topic/thread detail is gated behind
// sign-in (same freemium shape as keyword-research, but stricter: 0 free topic rows).
import { swallow } from '$lib/server/swallow';
import { env } from '$env/dynamic/private';
import { genaiClient, groundedText, structured } from './research';
import { dataforseoConfigured, fetchKeywordOverview } from './dataforseo';
import { safeFetchUrl } from './tool-guard';
import { scrapeCreatorsGet } from './scrapecreators';

export const FREE_TOPIC_LIMIT = 0;
export const FULL_TOPIC_TARGET = 12;
/** Rough monthly conversation units one post/reply can “cover”. Yardstick, not science. */
export const DEMAND_PER_POST = 400;
/** Default cadence when the visitor doesn’t say how often they post. */
export const DEFAULT_POSTS_PER_WEEK = 1;

export type ConversationChannel = 'forums' | 'social' | 'search' | 'mixed';

export type ConversationTopic = {
  phrasing: string;
  volume: number;
  channel: ConversationChannel;
  why: string;
  action: string;
  sampleThread: { title: string; url: string; source: string } | null;
};

export type ConversationGapResult = {
  focusSummary: string;
  brandLabel: string;
  demandLow: number;
  demandHigh: number;
  confidence: 'high' | 'medium' | 'low';
  /** 0–100. Higher = more unmet demand relative to publishing cadence. */
  gapScore: number;
  cadencePostsPerMonth: number;
  cadenceAssumed: boolean;
  topics: ConversationTopic[];
  totalTopics: number;
  freeLimit: number;
  methodNotes: string[];
  source: 'dataforseo' | 'ai' | 'mixed';
};

type Discovery = {
  brandName: string;
  brandedTerms: string[];
  language: string;
  focusSummary: string;
  topicsSold: string[];
  phrasings: Array<{
    phrasing: string;
    channel: ConversationChannel;
    why: string;
  }>;
};

const DISCOVERY_SCHEMA = {
  type: 'object' as const,
  properties: {
    brandName: { type: 'string' as const },
    brandedTerms: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Brand name, product names, slogans — anything that is brand demand, not category demand'
    },
    language: { type: 'string' as const, description: 'Primary market language code: it or en' },
    focusSummary: {
      type: 'string' as const,
      description: '1-2 sentences: what this business sells and the buyer problem it addresses'
    },
    topicsSold: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: '3-8 category topics the site already covers or sells (unbranded)'
    },
    phrasings: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          phrasing: {
            type: 'string' as const,
            description: 'How real people search or ask about this problem on forums/social — never include the brand name'
          },
          channel: { type: 'string' as const, enum: ['forums', 'social', 'search', 'mixed'] },
          why: { type: 'string' as const, description: 'Why this phrasing is relevant to what they sell' }
        },
        required: ['phrasing', 'channel', 'why']
      }
    }
  },
  required: ['brandName', 'brandedTerms', 'language', 'focusSummary', 'topicsSold', 'phrasings']
};

function normalizeUrl(input: string): string {
  const t = input.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function hostLabel(input: string): string {
  try {
    return new URL(normalizeUrl(input)).hostname.replace(/^www\./, '');
  } catch {
    return input;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
    'i'
  );
  const m = html.match(re);
  return (m?.[1] || m?.[2] || '').trim();
}

function extractHeadings(html: string): string[] {
  const out: string[] = [];
  const re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 20) {
    const t = stripTags(m[1]).slice(0, 120);
    if (t.length > 2) out.push(t);
  }
  return out;
}

function extractPageSignals(html: string, url: string): {
  title: string;
  description: string;
  headings: string[];
  text: string;
  host: string;
} {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const description = metaContent(html, 'description') || metaContent(html, 'og:description');
  const headings = extractHeadings(html);
  const text = stripTags(html).slice(0, 6000);
  return { title, description, headings, text, host: hostLabel(url) };
}

function containsBrand(text: string, branded: string[]): boolean {
  const lower = text.toLowerCase();
  return branded.some((b) => {
    const t = b.trim().toLowerCase();
    return t.length >= 3 && lower.includes(t);
  });
}

function normalizeChannel(raw: string): ConversationChannel {
  if (raw === 'forums' || raw === 'social' || raw === 'search' || raw === 'mixed') return raw;
  return 'mixed';
}

/**
 * Build a monthly demand range from observed volumes.
 * Sums overcount related phrasings, so we discount for overlap and widen into a band
 * (false precision of a single number is the failure mode this tool exists to avoid).
 */
export function estimateDemandRange(volumes: number[]): { low: number; high: number; mid: number } {
  const positive = volumes.map((v) => Math.max(0, Math.round(v))).filter((v) => v > 0);
  if (!positive.length) return { low: 0, high: 0, mid: 0 };
  const rawSum = positive.reduce((a, b) => a + b, 0);
  // Heavier discount when many related terms (more overlap risk).
  const overlapFactor = positive.length >= 8 ? 0.55 : positive.length >= 5 ? 0.65 : 0.75;
  const mid = Math.round(rawSum * overlapFactor);
  const low = Math.round(mid * 0.7);
  const high = Math.round(mid * 1.35);
  return { low: Math.max(0, low), high: Math.max(low, high), mid };
}

/**
 * Gap score 0–100: share of demand not plausibly covered by current publishing cadence.
 * cadencePostsPerMonth × DEMAND_PER_POST is treated as monthly “capacity”.
 */
export function computeGapScore(demandMid: number, postsPerMonth: number): number {
  if (demandMid <= 0) return 0;
  const capacity = Math.max(postsPerMonth, 0.25) * DEMAND_PER_POST;
  const uncovered = Math.max(0, demandMid - capacity);
  return Math.round(Math.min(100, Math.max(0, (uncovered / demandMid) * 100)));
}

export function confidenceFrom(opts: {
  volumeHits: number;
  phrasingCount: number;
  source: ConversationGapResult['source'];
  hasLiveThreads: boolean;
}): 'high' | 'medium' | 'low' {
  const { volumeHits, phrasingCount, source, hasLiveThreads } = opts;
  if (source !== 'ai' && volumeHits >= 5) return 'high';
  if (source !== 'ai' && volumeHits >= 3 && phrasingCount >= 4) return 'high';
  if (source !== 'ai' && volumeHits >= 1) return hasLiveThreads ? 'high' : 'medium';
  if (phrasingCount >= 4) return 'medium';
  return 'low';
}

function suggestAction(channel: ConversationChannel, volume: number): string {
  if (channel === 'forums' || channel === 'social') {
    return volume >= 200
      ? 'Join live threads with helpful replies, then turn the strongest angles into posts.'
      : 'Watch these threads weekly and reply where your expertise fits.';
  }
  if (volume >= 500) {
    return 'Publish a definitive post or short video that answers this in your brand voice.';
  }
  return 'Seed this angle into next week’s editorial plan.';
}

function scrapecreatorsAvailable(): boolean {
  return Boolean(env.SCRAPECREATORS_API_KEY);
}

async function fetchSampleThreads(
  queries: string[]
): Promise<Map<string, { title: string; url: string; source: string }>> {
  const out = new Map<string, { title: string; url: string; source: string }>();
  if (!scrapecreatorsAvailable() || !queries.length) return out;

  await Promise.all(
    queries.slice(0, 2).map(async (q) => {
      try {
        const data = await scrapeCreatorsGet(
          `/v1/reddit/search?query=${encodeURIComponent(q)}&sort=relevance&timeframe=month&trim=true`
        );
        const posts = (data?.posts ?? []) as Array<Record<string, unknown>>;
        const hit = posts.find((p) => {
          const permalink = String(p?.permalink ?? '');
          const title = String(p?.title ?? '');
          return title.length > 8 && permalink.includes('/comments/');
        });
        if (!hit) return;
        const permalink = String(hit.permalink);
        const url = permalink.startsWith('http')
          ? permalink
          : `https://www.reddit.com${permalink.startsWith('/') ? permalink : `/${permalink}`}`;
        out.set(q.toLowerCase(), {
          title: String(hit.title).slice(0, 160),
          url,
          source: `r/${String(hit.subreddit ?? 'reddit')}`
        });
      } catch (error) { swallow('fetch live thread', error); }
    })
  );
  return out;
}

async function discoverFromSite(url: string, signals: ReturnType<typeof extractPageSignals>): Promise<Discovery> {
  const ai = genaiClient();
  const prompt = `A brand sells something already. We need the UNBRANDED conversations around what they sell — not brand demand.

URL: ${url}
Host: ${signals.host}
Title: ${signals.title}
Meta: ${signals.description}
Headings: ${signals.headings.join(' | ').slice(0, 800)}
Page text (truncated): ${signals.text.slice(0, 3500)}

Find:
1) brandName + brandedTerms to EXCLUDE from opportunity sizing
2) topicsSold — category topics the site already covers
3) 6-10 conversation phrasings: how real people ask about the same problem on Reddit, forums, X/Threads, or Google — NEVER include the brand name or product names
4) language it|en

Prefer the site's primary language for phrasings.`;

  const grounded = await groundedText(
    ai,
    prompt,
    'You size category conversation demand, not brand vanity metrics. Use web search. Return real phrasings people use — inventing demand is worse than returning fewer items.'
  );

  const seeded = await structured<Discovery>(
    ai,
    `Normalise into the schema. Drop any phrasing that contains the brand or product names.\n\nRESEARCH:\n${grounded.text}`,
    DISCOVERY_SCHEMA,
    'Return only unbranded conversation phrasings with real buyer language.'
  );

  if (!seeded?.phrasings?.length) throw new Error('no phrasings');

  const branded = [
    ...(seeded.brandedTerms ?? []),
    seeded.brandName,
    signals.host.split('.')[0]
  ]
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length >= 3);

  const phrasings = (seeded.phrasings ?? [])
    .map((p) => ({
      phrasing: String(p.phrasing ?? '').trim(),
      channel: normalizeChannel(String(p.channel ?? 'mixed')),
      why: String(p.why ?? '').trim() || 'Relevant to what this site sells.'
    }))
    .filter((p) => p.phrasing.length >= 4 && !containsBrand(p.phrasing, branded))
    .slice(0, FULL_TOPIC_TARGET);

  if (!phrasings.length) throw new Error('all phrasings branded');

  return {
    brandName: String(seeded.brandName || signals.host).trim(),
    brandedTerms: branded,
    language: String(seeded.language || 'en').toLowerCase().startsWith('it') ? 'it' : 'en',
    focusSummary:
      String(seeded.focusSummary || '').trim() ||
      `Category conversations around what ${signals.host} already sells.`,
    topicsSold: (seeded.topicsSold ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8),
    phrasings
  };
}

/**
 * Public conversation-gap research. Returns the full topic list; the API strips it for anonymous callers.
 */
export async function researchConversationGap(
  rawUrl: string,
  opts?: { postsPerWeek?: number | null }
): Promise<ConversationGapResult | null> {
  const input = rawUrl.trim().slice(0, 300);
  if (!input) return null;

  const url = normalizeUrl(input);
  const postsPerWeek =
    opts?.postsPerWeek != null && Number.isFinite(opts.postsPerWeek) && opts.postsPerWeek > 0
      ? Math.min(14, Math.max(0.25, opts.postsPerWeek))
      : null;
  const cadenceAssumed = postsPerWeek == null;
  const cadencePostsPerMonth = Math.round((postsPerWeek ?? DEFAULT_POSTS_PER_WEEK) * 4.3 * 10) / 10;

  const methodNotes: string[] = [
    'Branded search terms are excluded — brand demand is not net-new opportunity.',
    'Volumes are monthly search/conversation estimates for how people discuss the problem, not your homepage wording.',
    'The result is a range because a single number would be false precision.'
  ];

  try {
    const fetched = await safeFetchUrl(url, { maxBytes: 1_500_000, timeoutMs: 18_000 });
    if (!fetched.ok && fetched.status >= 400) {
      throw new Error('Could not load that website');
    }
    const signals = extractPageSignals(fetched.body, fetched.url || url);
    if (signals.text.length < 80 && !signals.title) {
      throw new Error('That page did not return enough content to analyse');
    }

    const discovery = await discoverFromSite(fetched.url || url, signals);
    let source: ConversationGapResult['source'] = 'ai';
    const volumeByPhrase = new Map<string, number>();

    // Size from unbranded conversation phrasings (not brand vanity queries).
    if (dataforseoConfigured()) {
      const overview = await fetchKeywordOverview(
        discovery.phrasings.map((p) => p.phrasing),
        discovery.language
      );
      for (const m of overview) {
        if (m.volume > 0) volumeByPhrase.set(m.keyword.toLowerCase(), m.volume);
      }
      if (overview.some((m) => m.volume > 0)) source = 'dataforseo';

      // Soft fill: if few hits, try overview on category topic seeds too.
      if (volumeByPhrase.size < 3 && discovery.topicsSold.length) {
        const topicOverview = await fetchKeywordOverview(discovery.topicsSold.slice(0, 6), discovery.language);
        for (const m of topicOverview) {
          if (m.volume > 0 && !containsBrand(m.keyword, discovery.brandedTerms)) {
            volumeByPhrase.set(m.keyword.toLowerCase(), m.volume);
          }
        }
        if (volumeByPhrase.size) source = source === 'ai' ? 'mixed' : source;
      }
    }

    const sampleThreads = await fetchSampleThreads(
      discovery.phrasings
        .slice()
        .sort((a, b) => (volumeByPhrase.get(b.phrasing.toLowerCase()) ?? 0) - (volumeByPhrase.get(a.phrasing.toLowerCase()) ?? 0))
        .map((p) => p.phrasing)
    );
    if (sampleThreads.size) {
      methodNotes.push('Sampled recent forum threads for the strongest phrasings.');
      if (source === 'dataforseo') source = 'mixed';
    }

    const topics: ConversationTopic[] = discovery.phrasings.map((p) => {
      const volume = volumeByPhrase.get(p.phrasing.toLowerCase()) ?? 0;
      return {
        phrasing: p.phrasing,
        volume,
        channel: p.channel,
        why: p.why,
        action: suggestAction(p.channel, volume),
        sampleThread: sampleThreads.get(p.phrasing.toLowerCase()) ?? null
      };
    });

    // Prefer higher volume first; zero-volume AI phrasings still useful as directional topics.
    topics.sort((a, b) => b.volume - a.volume || a.phrasing.localeCompare(b.phrasing));
    const capped = topics.slice(0, FULL_TOPIC_TARGET);

    const volumes = capped.map((t) => t.volume);
    const { low, high, mid } = estimateDemandRange(volumes);
    // If DataForSEO returned nothing, invent a conservative directional band from phrasing count
    // so the free number still exists — labelled low confidence.
    let demandLow = low;
    let demandHigh = high;
    let demandMid = mid;
    if (mid === 0 && capped.length) {
      demandMid = capped.length * 80;
      demandLow = Math.round(demandMid * 0.5);
      demandHigh = Math.round(demandMid * 1.8);
      methodNotes.push('No reliable volume hits — range is a directional estimate from phrasing count only.');
      source = 'ai';
    }

    const volumeHits = volumes.filter((v) => v > 0).length;
    const confidence = confidenceFrom({
      volumeHits,
      phrasingCount: capped.length,
      source,
      hasLiveThreads: sampleThreads.size > 0
    });

    if (cadenceAssumed) {
      methodNotes.push(`Publishing cadence assumed at ${DEFAULT_POSTS_PER_WEEK}×/week when not provided.`);
    }

    return {
      focusSummary: discovery.focusSummary,
      brandLabel: discovery.brandName || signals.host,
      demandLow,
      demandHigh,
      confidence,
      gapScore: computeGapScore(demandMid, cadencePostsPerMonth),
      cadencePostsPerMonth,
      cadenceAssumed,
      topics: capped,
      totalTopics: capped.length,
      freeLimit: FREE_TOPIC_LIMIT,
      methodNotes,
      source
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    // Re-throw user-safe fetch errors so the route can return 400.
    if (/not reachable|too large|timed out|redirects|resolve|http\(s\)|Could not load|enough content/i.test(msg)) {
      throw e;
    }
    console.error('[conversation-gap]', e);
    return null;
  }
}

/** @internal exposed for tests */
export const _test = {
  containsBrand,
  extractPageSignals,
  stripTags
};
