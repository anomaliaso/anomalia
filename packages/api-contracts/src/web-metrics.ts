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
    'How this brand\'s website does in Google search over the last 28 days: clicks, ' +
    'impressions, the queries people arrived on and the pages they landed on — and whether ' +
    'the property is connected at all. This is website traffic, not post engagement; that one ' +
    'is get_analytics. Reads only — no model, no credits.',
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
    'Where this brand actually sits in Google for the keywords it tracks: the current ' +
    'position, the previous one, the move between them, the page that ranks, and whether an ' +
    'AI Overview appeared above it. Reads only — no model, no credits.',
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
    'Who links to this brand\'s site and who it links to, plus the exchanges still open and ' +
    'whether the network is unlocked for this brand at all (Starter plan or above, and opted ' +
    'in). Reads only — no model, no credits.',
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
