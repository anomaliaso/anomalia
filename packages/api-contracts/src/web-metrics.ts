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
    'How this brand\'s website does in Google search over the last 28 days: clicks, impressions, ' +
    'the queries people arrived on, the pages they landed on, and whether the property is ' +
    'connected at all. Website traffic, not post engagement — that one is get_analytics. Free.',
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

