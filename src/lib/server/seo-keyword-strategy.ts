// Per-brand SEO keyword attack strategy: which search keywords to target and where the best
// growth margins vs competitors are. Regenerated every ~14 days (bi-weekly loop); feeds blog
// topic/article generation and the Web → Keywords page. Mixes grounded AI research with
// DataForSEO volumes/difficulty so opportunity scores are honest.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { groundedText, structured } from './research';
import { fetchKeywordOverview, fetchKeywordSuggestions, type KeywordMetrics } from './dataforseo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type KeywordOpportunity = {
  keyword: string;
  intent: 'informational' | 'commercial' | 'transactional' | 'navigational';
  opportunity: 'high' | 'medium' | 'low';
  rationale: string;
  /** Concrete next step: blog post, landing, comparison, FAQ, etc. */
  action: string;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  competition?: string | null;
};

export type KeywordStrategy = {
  focusSummary: string;
  keywords: KeywordOpportunity[];
  competitorGaps: Array<{ competitor: string; gap: string }>;
};

/** Bi-weekly refresh window — cron runs weekly but only regenerates when stale. */
export const FRESH_DAYS = 14;

// Pure: is this row still fresh enough to reuse? Exported for testing.
export function isFresh(updatedAt: string | null, days = FRESH_DAYS): boolean {
  if (!updatedAt) return false;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  // Negative age = timestamp from the future (clock skew / bad write) → treat as stale, regenerate.
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < days * 24 * 3600 * 1000;
}

const STRATEGY_SCHEMA = {
  type: 'object' as const,
  properties: {
    focusSummary: { type: 'string' as const, description: 'One paragraph: the overall keyword attack focus.' },
    keywords: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          keyword: { type: 'string' as const },
          intent: { type: 'string' as const, enum: ['informational', 'commercial', 'transactional', 'navigational'] as const },
          opportunity: { type: 'string' as const, enum: ['high', 'medium', 'low'] as const },
          rationale: { type: 'string' as const, description: 'One line: why this keyword, and the gap it exploits.' },
          action: {
            type: 'string' as const,
            description: 'Concrete next step (e.g. "Write a comparison guide", "Create a landing page", "Publish a how-to blog").'
          }
        },
        required: ['keyword', 'intent', 'opportunity', 'rationale', 'action']
      }
    },
    competitorGaps: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          competitor: { type: 'string' as const },
          gap: { type: 'string' as const, description: 'What this competitor ranks for / covers that the brand can beat or fill.' }
        },
        required: ['competitor', 'gap']
      }
    }
  },
  required: ['focusSummary', 'keywords', 'competitorGaps']
};

type StrategyRow = { strategy: KeywordStrategy; updated_at: string };

function brandLang(brand: AnyRec): string | null {
  return (brand.content_prefs?.language as string) || null;
}

/** Re-score opportunity from real volume + difficulty when DataForSEO answered. */
export function scoreOpportunity(volume: number, difficulty: number): 'high' | 'medium' | 'low' {
  if (volume <= 0) return 'low';
  // Sweet spot: real demand + attainable difficulty.
  if (volume >= 100 && difficulty <= 40) return 'high';
  if (volume >= 50 && difficulty <= 55) return 'high';
  if (volume >= 20 && difficulty <= 70) return 'medium';
  if (volume >= 100 && difficulty <= 70) return 'medium';
  return 'low';
}

function mergeMetrics(keywords: KeywordOpportunity[], metrics: KeywordMetrics[]): KeywordOpportunity[] {
  const byKw = new Map(metrics.map((m) => [m.keyword.toLowerCase(), m]));
  return keywords.map((k) => {
    const m = byKw.get(k.keyword.toLowerCase());
    if (!m) return k;
    const volume = m.volume;
    const difficulty = m.difficulty;
    return {
      ...k,
      volume,
      difficulty,
      cpc: m.cpc,
      competition: m.competition,
      // Prefer DataForSEO intent when present; keep AI intent otherwise.
      intent: (['informational', 'commercial', 'transactional', 'navigational'].includes(String(m.intent))
        ? (m.intent as KeywordOpportunity['intent'])
        : k.intent),
      opportunity: scoreOpportunity(volume, difficulty)
    };
  });
}

function sortByOpportunity(keywords: KeywordOpportunity[]): KeywordOpportunity[] {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...keywords].sort((a, b) => {
    const o = rank[a.opportunity] - rank[b.opportunity];
    if (o !== 0) return o;
    return (b.volume ?? 0) - (a.volume ?? 0);
  });
}

async function generateStrategy(admin: SupabaseClient, brand: AnyRec): Promise<KeywordStrategy | null> {
  const [{ data: competitors }, { data: strategyRow }, { data: kit }] = await Promise.all([
    admin.from('competitors').select('name, website, kind, rationale').eq('brand_id', brand.id).limit(6),
    admin.from('brand_strategy').select('report').eq('brand_id', brand.id).maybeSingle(),
    admin.from('brand_kit').select('about, category, target_audience').eq('brand_id', brand.id).maybeSingle()
  ]);
  const report = (strategyRow?.report ?? {}) as AnyRec;
  const competitorLines = (competitors ?? [])
    .map((c) => `- ${c.name}${c.website ? ` (${c.website})` : ''} [${c.kind}]: ${c.rationale ?? ''}`)
    .join('\n') || '(none known yet)';

  let gscBlock = '';
  try {
    const { isGscInAgentEnabled } = await import('$lib/server/feature-flags');
    if (isGscInAgentEnabled()) {
      const { loadGscSummary, formatGscPromptBlock } = await import('$lib/server/gsc');
      const gsc = await loadGscSummary(admin, String(brand.id));
      gscBlock = formatGscPromptBlock(gsc);
    }
  } catch (error) { swallow('load gsc summary', error); }

  const grounded = await groundedText(
    `Research SEO keyword opportunities for this brand.

BRAND: ${brand.name} — ${kit?.about ?? ''}
Website: ${brand.website ?? 'n/a'}
Category: ${kit?.category ?? ''}. Audience: ${kit?.target_audience ?? ''}
White space: ${(report.whiteSpace ?? []).join('; ') || 'n/a'}
Recommended content angles: ${(report.recommendedAngles ?? []).join('; ') || 'n/a'}
Differentiators: ${(report.differentiators ?? []).join('; ') || 'n/a'}

Named competitors:
${competitorLines}
${gscBlock ? `\n${gscBlock}\nPrefer owned GSC queries when proposing target keywords (include them with opportunity high when they have demand or clear growth potential).\n` : ''}
Using real, current web information: which search keywords have real demand for this brand's niche? What content do the named competitors actually rank for or publish about? Where are the underserved keyword/content gaps this brand can attack to win traffic? Be concrete and cite what you actually find.`,
    'You are an SEO research assistant. Use web search and report only real, verifiable observations. Never invent keywords, search volumes, or competitor content that you did not actually find. Prefer Google Search Console owned queries when provided.'
  );

  const strategy = await structured<KeywordStrategy>(
    `Normalise this SEO research into structured data: an overall focusSummary (one paragraph), 10-18 target keywords (each with search intent, opportunity level, a one-line rationale, and a concrete action to take), and 3-6 competitor gaps to exploit. Use the brand's own content language for keywords where relevant.\n\nRESEARCH:\n${grounded.text}`,
    STRATEGY_SCHEMA
  );
  if (!strategy?.keywords?.length) throw new Error('empty strategy');

  // Enrich with DataForSEO volumes/difficulty, then expand with suggestions around top seeds.
  const lang = brandLang(brand);
  const seedKeywords = strategy.keywords.slice(0, 5).map((k) => k.keyword);
  const [overview, ...suggestionBatches] = await Promise.all([
    fetchKeywordOverview(
      strategy.keywords.map((k) => k.keyword),
      lang
    ),
    ...seedKeywords.slice(0, 3).map((seed) => fetchKeywordSuggestions(seed, lang, 8))
  ]);

  const suggestionMetrics = suggestionBatches.flat();
  const known = new Set(strategy.keywords.map((k) => k.keyword.toLowerCase()));
  const extras: KeywordOpportunity[] = [];
  for (const m of suggestionMetrics) {
    if (known.has(m.keyword.toLowerCase())) continue;
    if (m.volume < 10) continue;
    known.add(m.keyword.toLowerCase());
    extras.push({
      keyword: m.keyword,
      intent: (['informational', 'commercial', 'transactional', 'navigational'].includes(String(m.intent))
        ? (m.intent as KeywordOpportunity['intent'])
        : 'informational'),
      opportunity: scoreOpportunity(m.volume, m.difficulty),
      rationale: `Related long-tail around "${seedKeywords[0] ?? 'core topics'}" with measurable search demand.`,
      action: 'Publish a focused blog or landing page that answers this query.',
      volume: m.volume,
      difficulty: m.difficulty,
      cpc: m.cpc,
      competition: m.competition
    });
    if (extras.length >= 8) break;
  }

  const merged = sortByOpportunity(
    mergeMetrics([...strategy.keywords, ...extras], [...overview, ...suggestionMetrics])
  ).slice(0, 24);

  const enriched: KeywordStrategy = {
    focusSummary: strategy.focusSummary,
    keywords: merged,
    competitorGaps: strategy.competitorGaps ?? []
  };

  await admin.from('brand_seo_keyword_strategy').upsert(
    {
      brand_id: brand.id,
      strategy: enriched,
      citations: grounded.citations,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'brand_id' }
  );
  return enriched;
}

// Read the brand's keyword strategy, regenerating if missing/stale. Best-effort: never throws —
// blog generation must keep working even if this fails or the table doesn't exist yet.
export async function ensureKeywordStrategy(
  admin: SupabaseClient,
  brand: AnyRec,
  opts?: { force?: boolean }
): Promise<KeywordStrategy | null> {
  // supabase-js returns errors as values (never throws): a missing table (migration not applied
  // yet) or any other read error lands in `error` — bail out cheaply instead of burning two AI
  // calls per article that could never be cached anyway.
  const { data, error } = await admin
    .from('brand_seo_keyword_strategy')
    .select('strategy, updated_at')
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (error) return null;
  const row = (data ?? null) as StrategyRow | null;
  if (!opts?.force && row && isFresh(row.updated_at)) return normalizeStrategy(row.strategy);

  try {
    return await generateStrategy(admin, brand);
  } catch {
    return row ? normalizeStrategy(row.strategy) : null; // keep serving the stale strategy over generating nothing
  }
}

/** Back-compat for older rows that lack `action` / metrics. */
export function normalizeStrategy(s: KeywordStrategy | null | undefined): KeywordStrategy | null {
  if (!s?.keywords?.length) return s ?? null;
  return {
    focusSummary: s.focusSummary ?? '',
    competitorGaps: s.competitorGaps ?? [],
    keywords: s.keywords.map((k) => ({
      keyword: k.keyword,
      intent: k.intent ?? 'informational',
      opportunity: k.opportunity ?? 'medium',
      rationale: k.rationale ?? '',
      action: k.action || 'Create content that targets this keyword.',
      volume: k.volume,
      difficulty: k.difficulty,
      cpc: k.cpc,
      competition: k.competition ?? null
    }))
  };
}

// Pure: compact prompt block for the blog prompts. '' when there's no strategy yet.
export function keywordStrategyBlock(s: KeywordStrategy | null): string {
  if (!s) return '';
  const keywords = (s.keywords ?? [])
    .slice(0, 12)
    .map((k) => {
      const metrics =
        k.volume != null ? ` vol=${k.volume}${k.difficulty != null ? ` kd=${k.difficulty}` : ''}` : '';
      return `${k.keyword} (${k.intent}, ${k.opportunity}${metrics})`;
    })
    .join(', ');
  const gaps = (s.competitorGaps ?? []).map((g) => `${g.competitor}: ${g.gap}`).join('; ');
  const block = `SEO ATTACK STRATEGY (authoritative — target these):
Focus: ${s.focusSummary}
Keywords to attack: ${keywords}
Competitor gaps to exploit: ${gaps}`;
  return block.slice(0, 1600);
}
