import { z } from 'zod';
import type { BrandEndpoint } from './index';

const NoInput = z.object({}).strict();

const SearchRow = z.object({
  clicks: z.number(),
  impressions: z.number(),
  position: z.number()
});

export const GET_GSC = {
  tool: 'get_gsc',
  title: 'Search Console',
  description:
    'Google Search Console over the last 28 days: clicks, impressions, top queries and pages, and whether the property is connected.',
  method: 'GET',
  pathUnderBrand: '/gsc',
  input: NoInput,
  output: z.object({
    connected: z.boolean(),
    configured: z.boolean(),
    siteUrl: z.string().nullable(),
    syncedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    clicks28d: z.number(),
    impressions28d: z.number(),
    topQueries: z.array(SearchRow.extend({ query: z.string() })),
    topPages: z.array(SearchRow.extend({ page: z.string() }))
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_RANKS = {
  tool: 'get_ranks',
  title: 'Rank tracking',
  description:
    'Tracked keywords with their current Google position, the previous one, the move between them, the ranking URL and whether an AI Overview showed.',
  method: 'GET',
  pathUnderBrand: '/ranks',
  input: NoInput,
  output: z.object({
    keywords: z.array(
      z.object({
        id: z.string(),
        keyword: z.string(),
        locale: z.string(),
        device: z.string(),
        source: z.string(),
        active: z.boolean(),
        position: z.number().nullable(),
        prevPosition: z.number().nullable(),
        delta: z.number().nullable(),
        url: z.string().nullable(),
        checkedAt: z.string().nullable(),
        hasAiOverview: z.boolean()
      })
    )
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

const BacklinkPlacement = z.object({
  id: z.string(),
  sourceBrandId: z.string(),
  sourceArticleId: z.string().nullable(),
  targetBrandId: z.string(),
  targetArticleId: z.string().nullable(),
  targetUrl: z.string(),
  anchorText: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  partnerName: z.string().nullable().optional()
});

export const GET_BACKLINKS = {
  tool: 'get_backlinks',
  title: 'Backlink network',
  description:
    'Backlink network: links given and received, open give/receive opportunities, and whether the network is unlocked for this brand (Starter or above, plus opt-in).',
  method: 'GET',
  pathUnderBrand: '/backlinks',
  input: NoInput,
  output: z.object({
    enabled: z.boolean(),
    planAllowed: z.boolean(),
    unlocked: z.boolean(),
    outgoing: z.array(BacklinkPlacement),
    incoming: z.array(BacklinkPlacement),
    opportunities: z.array(
      z.object({
        id: z.string(),
        direction: z.enum(['give', 'receive']),
        partnerBrandId: z.string(),
        partnerBrandName: z.string(),
        partnerArticleId: z.string().nullable(),
        partnerUrl: z.string(),
        partnerTitle: z.string().nullable(),
        relevance: z.number(),
        suggestedAnchor: z.string().nullable(),
        rationale: z.string().nullable(),
        status: z.string(),
        createdAt: z.string()
      })
    ),
    stats: z.object({
      outgoingCount: z.number(),
      incomingCount: z.number(),
      openGive: z.number(),
      openReceive: z.number()
    })
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
