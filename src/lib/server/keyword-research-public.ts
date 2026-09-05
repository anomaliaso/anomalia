// Public (unauthenticated) keyword research for the free marketing tool.
// Mixes a light AI niche read with DataForSEO suggestions/metrics. Caps free
// results at FREE_LIMIT; full lists live behind sign-in → brand Keywords page.
import { groundedText, structured } from './research';
import {
  dataforseoConfigured,
  fetchDomainKeywords,
  fetchKeywordOverview,
  fetchKeywordSuggestions,
  type KeywordMetrics
} from './dataforseo';
import { scoreOpportunity, type KeywordOpportunity } from './seo-keyword-strategy';

export const FREE_KEYWORD_LIMIT = 5;
export const FULL_KEYWORD_TARGET = 20;

export type PublicKeywordResearch = {
  focusSummary: string;
  keywords: KeywordOpportunity[];
  totalFound: number;
  freeLimit: number;
  source: 'dataforseo' | 'ai' | 'mixed';
};

type SeedResult = {
  focusSummary: string;
  seeds: string[];
  language: string;
};

const SEED_SCHEMA = {
  type: 'object' as const,
  properties: {
    focusSummary: { type: 'string' as const },
    language: { type: 'string' as const, description: 'Primary market language code: it or en' },
    seeds: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: '3-6 concrete seed keywords people actually search for in this niche'
    }
  },
  required: ['focusSummary', 'language', 'seeds']
};

function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(input);
}

function normalizeUrl(input: string): string {
  const t = input.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function metricsToOpportunity(m: KeywordMetrics, rationale: string, action: string): KeywordOpportunity {
  return {
    keyword: m.keyword,
    intent: (['informational', 'commercial', 'transactional', 'navigational'].includes(String(m.intent))
      ? (m.intent as KeywordOpportunity['intent'])
      : 'informational'),
    opportunity: scoreOpportunity(m.volume, m.difficulty),
    rationale,
    action,
    volume: m.volume,
    difficulty: m.difficulty,
    cpc: m.cpc,
    competition: m.competition
  };
}

function dedupeSort(items: KeywordOpportunity[]): KeywordOpportunity[] {
  const seen = new Set<string>();
  const out: KeywordOpportunity[] = [];
  const rank = { high: 0, medium: 1, low: 2 };
  for (const k of [...items].sort((a, b) => {
    const o = rank[a.opportunity] - rank[b.opportunity];
    if (o !== 0) return o;
    return (b.volume ?? 0) - (a.volume ?? 0);
  })) {
    const key = k.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

async function discoverSeeds(input: string): Promise<SeedResult> {
  const asUrl = isUrl(input);
  const prompt = asUrl
    ? `Look at this website and identify the SEO niche + 3-6 seed keywords people would search to find this business or its topics.\nURL: ${normalizeUrl(input)}\nReturn seeds in the site's primary language.`
    : `Identify the SEO niche for this topic/brand description and list 3-6 seed keywords people actually search for.\nTopic: ${input}\nPrefer the language of the input.`;

  const grounded = await groundedText(
    prompt,
    'You are an SEO research assistant. Use web search. Return only real, searchable keyword phrases — never invent demand.'
  );
  const seeded = await structured<SeedResult>(
    `Normalise into focusSummary, language (it|en), and 3-6 seed keywords.\n\nRESEARCH:\n${grounded.text}`,
    SEED_SCHEMA
  );
  if (!seeded?.seeds?.length) throw new Error('no seeds');
  return {
    focusSummary: seeded.focusSummary || 'Keyword opportunities for this niche.',
    language: (seeded.language || 'en').toLowerCase().startsWith('it') ? 'it' : 'en',
    seeds: seeded.seeds.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
  };
}

/**
 * Public keyword research. Returns up to FULL_KEYWORD_TARGET ranked opportunities;
 * the free UI only shows FREE_KEYWORD_LIMIT and gates the rest behind sign-in.
 */
export async function researchPublicKeywords(rawInput: string): Promise<PublicKeywordResearch | null> {
  const input = rawInput.trim().slice(0, 300);
  if (!input) return null;

  let focusSummary = '';
  let lang: string | null = null;
  let metrics: KeywordMetrics[] = [];
  let source: PublicKeywordResearch['source'] = 'ai';

  try {
    if (isUrl(input) && dataforseoConfigured()) {
      // Fast path: pull ranked keywords for the domain, then expand suggestions.
      const domainKw = await fetchDomainKeywords(normalizeUrl(input), null, 15);
      if (domainKw.length) {
        metrics.push(...domainKw);
        source = 'dataforseo';
        const topSeeds = domainKw.slice(0, 3).map((k) => k.keyword);
        const suggestions = (
          await Promise.all(topSeeds.map((s) => fetchKeywordSuggestions(s, null, 10)))
        ).flat();
        metrics.push(...suggestions);
        if (suggestions.length) source = 'mixed';
        focusSummary = `Keyword opportunities around ${hostLabel(input)} — ranked terms plus related long-tails with real search demand.`;
      }
    }

    if (metrics.length < 5) {
      const seeds = await discoverSeeds(input);
      focusSummary = focusSummary || seeds.focusSummary;
      lang = seeds.language;
      if (dataforseoConfigured()) {
        const batches = await Promise.all(
          seeds.seeds.slice(0, 4).map((s) => fetchKeywordSuggestions(s, lang, 12))
        );
        const sug = batches.flat();
        if (sug.length) {
          metrics.push(...sug);
          source = metrics.length > sug.length ? 'mixed' : 'dataforseo';
        } else {
          const overview = await fetchKeywordOverview(seeds.seeds, lang);
          metrics.push(...overview);
          source = overview.length ? 'mixed' : 'ai';
        }
        // Fallback: AI seeds without volumes still useful as directional opportunities.
        if (!metrics.length) {
          metrics = seeds.seeds.map((keyword) => ({
            keyword,
            volume: 0,
            difficulty: 0,
            cpc: 0,
            competition: null,
            intent: null
          }));
          source = 'ai';
        }
      } else {
        metrics = seeds.seeds.map((keyword) => ({
          keyword,
          volume: 0,
          difficulty: 0,
          cpc: 0,
          competition: null,
          intent: null
        }));
        source = 'ai';
      }
    }
  } catch {
    return null;
  }

  const opportunities = dedupeSort(
    metrics.map((m) =>
      metricsToOpportunity(
        m,
        m.volume > 0
          ? `~${m.volume}/mo searches · difficulty ${m.difficulty}`
          : 'Directional opportunity from niche research.',
        suggestAction(m)
      )
    )
  ).slice(0, FULL_KEYWORD_TARGET);

  if (!opportunities.length) return null;

  return {
    focusSummary: focusSummary || 'Keyword opportunities for this niche.',
    keywords: opportunities,
    totalFound: opportunities.length,
    freeLimit: FREE_KEYWORD_LIMIT,
    source
  };
}

function hostLabel(input: string): string {
  try {
    return new URL(normalizeUrl(input)).hostname.replace(/^www\./, '');
  } catch {
    return input;
  }
}

function suggestAction(m: KeywordMetrics): string {
  const intent = String(m.intent ?? '');
  if (intent === 'commercial' || intent === 'transactional') {
    return 'Build a landing page or comparison that converts this intent.';
  }
  if (m.difficulty <= 35 && m.volume >= 50) {
    return 'Publish a definitive how-to or guide — high opportunity, attainable difficulty.';
  }
  if (m.difficulty > 60) {
    return 'Target via a supporting cluster of long-tail pages first.';
  }
  return 'Create focused content that answers this query better than current results.';
}
