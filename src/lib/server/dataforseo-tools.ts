// DataForSEO research tools for AI agents (chat + SEO agent).
// Same surface as the official DataForSEO MCP modules we use in production: Labs, SERP, Backlinks.
// Implemented as AI SDK tools (not a subprocess MCP) so Vercel stays pay-per-call with our existing
// logging/cost metering in dataforseo.ts. Cursor still gets the real MCP via mcp.json.
import { tool } from 'ai';
import { z } from 'zod';
import {
  dataforseoConfigured,
  fetchBacklinkHistory,
  fetchBacklinkSummary,
  fetchDomainOverview,
  fetchHistoricalRankOverview,
  fetchKeywordGap,
  fetchKeywordOverview,
  fetchKeywordSuggestions,
  fetchSearchPerformance,
  fetchSerpSnapshot
} from './dataforseo';

export const DATAFORSEO_TOOL_KEYS = [
  'dfs_domain_overview',
  'dfs_search_performance',
  'dfs_keyword_metrics',
  'dfs_keyword_suggestions',
  'dfs_keyword_gap',
  'dfs_serp',
  'dfs_backlinks',
  'dfs_traffic_history',
  'dfs_backlink_history'
] as const;

/** Cheap/live Labs+SERP tools — safe for every chat turn. History endpoints are opt-in (costlier). */
export const DATAFORSEO_CHAT_TOOL_KEYS = DATAFORSEO_TOOL_KEYS.filter(
  (k) => k !== 'dfs_traffic_history' && k !== 'dfs_backlink_history'
);

export type DataForSeoToolsOpts = {
  /** Brand site URL used when the model omits `url`. */
  defaultUrl?: string | null;
  /** Async resolver when the URL isn't known at construction (chat tools). */
  resolveDefaultUrl?: () => Promise<string | null>;
  language?: string | null;
  resolveLanguage?: () => Promise<string | null>;
  /** Hard cap on paid DataForSEO calls per agent/chat turn. */
  maxCalls?: number;
  /** Enable monthly history endpoints (~$0.13–0.16 each). Off for chat by default. */
  allowHistory?: boolean;
};

async function resolveUrl(
  inputUrl: string | undefined,
  opts: DataForSeoToolsOpts
): Promise<string | null> {
  const raw = (inputUrl || opts.defaultUrl || (opts.resolveDefaultUrl ? await opts.resolveDefaultUrl() : '') || '').trim();
  return raw || null;
}

async function resolveLang(opts: DataForSeoToolsOpts): Promise<string | null> {
  if (opts.language) return opts.language;
  if (opts.resolveLanguage) return opts.resolveLanguage();
  return null;
}

/**
 * Build the DataForSEO tool pack. Callers spread this into their `tools` object.
 * Returns empty object when credentials are missing so agents degrade gracefully.
 */
export function createDataForSeoTools(opts: DataForSeoToolsOpts = {}) {
  if (!dataforseoConfigured()) return {} as Record<string, never>;

  const maxCalls = Math.max(1, opts.maxCalls ?? 8);
  let callsUsed = 0;
  const bump = () => {
    if (callsUsed >= maxCalls) {
      return {
        error: 'dataforseo_budget_exhausted',
        message: `DataForSEO call budget for this turn is exhausted (${maxCalls}). Finish with what you have or ask the user to continue.`
      } as const;
    }
    callsUsed += 1;
    return null;
  };

  const tools = {
    dfs_domain_overview: tool({
      description:
        'DataForSEO Labs: organic keyword count, estimated monthly traffic, top-3/top-10 counts for a domain. Use for traffic/visibility snapshots.',
      inputSchema: z.object({
        url: z.string().optional().describe('Domain or URL. Defaults to the brand website.')
      }),
      execute: async ({ url }) => {
        const blocked = bump();
        if (blocked) return blocked;
        const target = await resolveUrl(url, opts);
        if (!target) return { error: 'Missing url' };
        const data = await fetchDomainOverview(target, await resolveLang(opts));
        return data ?? { error: 'No domain overview data' };
      }
    }),

    dfs_search_performance: tool({
      description:
        'DataForSEO Labs: organic keywords, est. monthly traffic, keywords in top 10, and the top ranking keywords table (with volume/difficulty/intent).',
      inputSchema: z.object({
        url: z.string().optional().describe('Domain or URL. Defaults to the brand website.')
      }),
      execute: async ({ url }) => {
        const blocked = bump();
        if (blocked) return blocked;
        const target = await resolveUrl(url, opts);
        if (!target) return { error: 'Missing url' };
        const data = await fetchSearchPerformance(target, await resolveLang(opts));
        if (!data) return { error: 'No search performance data' };
        // Drop nested history if present — use dfs_traffic_history explicitly.
        const { history: _h, ...rest } = data;
        return rest;
      }
    }),

    dfs_keyword_metrics: tool({
      description:
        'DataForSEO Labs: search volume, difficulty, CPC, competition, and intent for up to 20 keywords.',
      inputSchema: z.object({
        keywords: z.array(z.string().min(1)).min(1).max(20)
      }),
      execute: async ({ keywords }) => {
        const blocked = bump();
        if (blocked) return blocked;
        const rows = await fetchKeywordOverview(keywords, await resolveLang(opts));
        return { keywords: rows };
      }
    }),

    dfs_keyword_suggestions: tool({
      description:
        'DataForSEO Labs: related keyword suggestions around a seed, with volume and difficulty.',
      inputSchema: z.object({
        seed: z.string().min(1),
        limit: z.number().int().min(1).max(30).optional()
      }),
      execute: async ({ seed, limit }) => {
        const blocked = bump();
        if (blocked) return blocked;
        const rows = await fetchKeywordSuggestions(seed, await resolveLang(opts), limit ?? 15);
        return { suggestions: rows };
      }
    }),

    dfs_keyword_gap: tool({
      description:
        'DataForSEO Labs: keyword gap vs a competitor — keywords they rank for where you are absent or worse.',
      inputSchema: z.object({
        yourUrl: z.string().optional().describe('Your domain. Defaults to the brand website.'),
        competitorUrl: z.string().describe('Competitor domain or URL.'),
        limit: z.number().int().min(1).max(40).optional()
      }),
      execute: async ({ yourUrl, competitorUrl, limit }) => {
        const blocked = bump();
        if (blocked) return blocked;
        const yours = await resolveUrl(yourUrl, opts);
        if (!yours) return { error: 'Missing yourUrl' };
        const rows = await fetchKeywordGap(yours, competitorUrl, await resolveLang(opts), limit ?? 20);
        return { gaps: rows };
      }
    }),

    dfs_serp: tool({
      description:
        'DataForSEO live Google SERP: where a domain ranks for a keyword, top 10 results, and whether an AI Overview is present (and which domains it cites).',
      inputSchema: z.object({
        keyword: z.string().min(1),
        url: z.string().optional().describe('Domain to locate in the SERP. Defaults to the brand website.')
      }),
      execute: async ({ keyword, url }) => {
        const blocked = bump();
        if (blocked) return blocked;
        const target = await resolveUrl(url, opts);
        const data = await fetchSerpSnapshot(keyword, target, await resolveLang(opts));
        return data ?? { error: 'No SERP data' };
      }
    }),

    dfs_backlinks: tool({
      description:
        'DataForSEO Backlinks: domain rating (0–100), referring domains, backlink counts, spam score, dofollow/nofollow split, top TLDs.',
      inputSchema: z.object({
        url: z.string().optional().describe('Domain or URL. Defaults to the brand website.')
      }),
      execute: async ({ url }) => {
        const blocked = bump();
        if (blocked) return blocked;
        const target = await resolveUrl(url, opts);
        if (!target) return { error: 'Missing url' };
        const data = await fetchBacklinkSummary(target);
        if (!data) return { error: 'No backlink data' };
        const { history: _h, ...rest } = data;
        return rest;
      }
    })
  };

  if (!opts.allowHistory) return tools;

  return {
    ...tools,
    dfs_traffic_history: tool({
      description:
        'DataForSEO Labs historical rank overview: ~12 months of estimated traffic, organic keyword counts, and new/lost keyword deltas. Costlier (~$0.13) — use once per review when you need trends.',
      inputSchema: z.object({
        url: z.string().optional(),
        months: z.number().int().min(3).max(24).optional()
      }),
      execute: async ({ url, months }) => {
        const blocked = bump();
        if (blocked) return blocked;
        const target = await resolveUrl(url, opts);
        if (!target) return { error: 'Missing url' };
        const history = await fetchHistoricalRankOverview(target, await resolveLang(opts), months ?? 12);
        return history ? { history } : { error: 'No traffic history' };
      }
    }),

    dfs_backlink_history: tool({
      description:
        'DataForSEO Backlinks history: monthly domain rating and referring-domain trend. Costlier — use once per review when you need authority trends.',
      inputSchema: z.object({
        url: z.string().optional(),
        months: z.number().int().min(3).max(24).optional()
      }),
      execute: async ({ url, months }) => {
        const blocked = bump();
        if (blocked) return blocked;
        const target = await resolveUrl(url, opts);
        if (!target) return { error: 'Missing url' };
        const history = await fetchBacklinkHistory(target, months ?? 12);
        return history ? { history } : { error: 'No backlink history' };
      }
    })
  };
}
