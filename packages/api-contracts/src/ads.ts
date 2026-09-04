import { z } from 'zod';
import type { BrandEndpoint } from './index';

const RemixBrief = z.looseObject({
  rank: z.number(),
  strategy: z.string(),
  keep: z.string().nullable().optional(),
  change: z.string().nullable().optional(),
  hook: z.string(),
  headline: z.string(),
  body: z.string().nullable().optional(),
  cta: z.string().nullable().optional(),
  productName: z.string().nullable().optional(),
  visualPrompt: z.string().nullable().optional()
});

export const ADS_REMIX = {
  tool: 'ads_remix',
  title: 'Ads remix',
  description:
    'Harvest competitor/trending ads, analyze with vision, and return ranked remix briefs in ' +
    'brand voice (hook, headline, body, CTA, product, visualPrompt). Replaces previous briefs. ' +
    'Costs credits.',
  method: 'POST',
  pathUnderBrand: '/ads/remix',
  input: z.object({}).strict(),
  output: z.object({ ok: z.literal(true), briefs: z.array(RemixBrief) }),
  failures: [
    { error: 'no_competitor_ads', status: 400 },
    { error: 'no_remix_briefs', status: 400 },
    { error: 'ads_not_on_plan', status: 403 },
    { error: 'credits_exhausted', status: 402 },
    { error: 'Not found', status: 404 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const ADS_ACTION = {
  tool: 'ads_action',
  title: 'Ads action',
  description:
    'Run an ads action. Common actions: sync, propose, create, reject, pause, resume, toggle, ' +
    'duplicate, delete. Pass campaignId; for a single creative add adId (and next active|paused ' +
    'for toggle). duplicate creates a paused copy as a new proposal; approve it to launch. Pass ' +
    'extra fields as needed.',
  method: 'POST',
  pathUnderBrand: '/ads',
  input: z
    .object({
      action: z.string().min(1),
      campaignId: z.string().optional(),
      extra: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Additional action payload fields')
    })
    .strict(),
  output: z.looseObject({
    ok: z.boolean().optional(),
    error: z.string().optional(),
    created: z.number().optional(),
    candidates: z.number().optional(),
    zernioAdId: z.string().optional(),
    accounts: z.number().optional(),
    metrics: z.number().optional(),
    id: z.string().optional(),
    next: z.enum(['active', 'paused']).optional(),
    copiedCampaignId: z.string().optional()
  }),
  failures: [
    { error: 'missing_campaignId', status: 400 },
    { error: 'unknown_action', status: 400 },
    { error: 'ads_not_on_plan', status: 403 },
    { error: 'Not found', status: 404 }
  ],
  destructive: true
} satisfies BrandEndpoint;
