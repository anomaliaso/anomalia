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
    'Find the ads that are working — competitors\' and the ones trending in this market — look ' +
    'at them, and come back with ranked briefs for ads of your own: hook, headline, body, ' +
    'call to action, product, and a prompt for the picture. It spends credits, and it ' +
    'replaces the briefs from last time. It creates no ad and launches nothing: ads_action is ' +
    'what does that. `no_competitor_ads` means there was nothing to learn from — add ' +
    'competitors first.',
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
    'Change the brand\'s paid campaigns: `sync` pulls the current state from the advertising ' +
    'account, `propose` has the AI draft new ads, then `create`, `reject`, `pause`, `resume`, ' +
    '`toggle`, `duplicate` and `delete` act on what is there. Pass `campaignId`, and `adId` ' +
    'in `extra` when it is one creative (`next` is active or paused for `toggle`). ' +
    '`duplicate` makes a paused copy as a new proposal — approving it is what launches it. ' +
    'Read get_ads first: `ads_not_on_plan` means this brand\'s plan has no advertising at all.',
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
