import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const SHARED_VIEW_TYPES = ['calendar', 'dashboard', 'monthly_report', 'strategy', 'workspace'] as const;

export type SharedViewType = (typeof SHARED_VIEW_TYPES)[number];

const MONTH = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .describe('Month YYYY-MM. Defaults to the current month on the brand clock');

const MAX_EXPIRY_DAYS = 365;

const SharedViewRow = z.object({
  id: z.string(),
  view: z.enum(SHARED_VIEW_TYPES),
  month: z.string().nullable(),
  status: z.enum(['live', 'revoked', 'expired']),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable()
});

export const CREATE_SHARE = {
  tool: 'create_share',
  title: 'Create a public client link',
  description:
    'Freeze one view as a snapshot and return a public link a client can open without an account. ' +
    'The link grants that snapshot and nothing else: no brand account, no live data, no connectors, ' +
    'notes, prompts, costs, settings or member data. The token is shown once and never stored in ' +
    'readable form — save it now or revoke and create another.',
  method: 'POST',
  pathUnderBrand: '/shares',
  input: z
    .object({
      view: z
        .enum(SHARED_VIEW_TYPES)
        .describe(
          'calendar = the month plan; dashboard = the month at a glance (what went out, what is planned, reach); monthly_report = what that month published; strategy = the agreed plan behind it (statement, cadence, platforms, weeks, current phase); workspace = all of the above behind one link'
        ),
      month: MONTH.optional(),
      expires_in_days: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_EXPIRY_DAYS)
        .optional()
        .describe('Days before the link stops working. Omit for a link that lasts until revoked')
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    id: z.string(),
    view: z.enum(SHARED_VIEW_TYPES),
    month: z.string(),
    url: z.string(),
    token: z.string(),
    expires_at: z.string().nullable()
  }),
  failures: [
    { error: 'shares_not_migrated', status: 500 },
    { error: 'snapshot_failed', status: 500 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const LIST_SHARES = {
  tool: 'list_shares',
  title: 'List public client links',
  description:
    'Public links created for this brand, newest first, with their state. The tokens are not here: ' +
    'only their hashes are stored, so a link that was not saved at creation can only be replaced.',
  method: 'GET',
  pathUnderBrand: '/shares',
  input: z.object({}).strict(),
  output: z.object({ shares: z.array(SharedViewRow) }),
  failures: [{ error: 'shares_not_migrated', status: 500 }],
  destructive: false
} satisfies BrandEndpoint;

export const REVOKE_SHARE = {
  tool: 'revoke_share',
  title: 'Revoke a public client link',
  description:
    'Turn one public link off. From then on it answers exactly like a link that never existed. ' +
    'Brand membership is untouched: revoking removes nobody from the brand.',
  method: 'POST',
  pathUnderBrand: '/shares/revoke',
  input: z.object({ id: z.string().min(1).describe('Share id from list_shares') }).strict(),
  output: z.object({ ok: z.literal(true), id: z.string(), revoked_at: z.string() }),
  failures: [
    { error: 'share_not_found', status: 404 },
    { error: 'shares_not_migrated', status: 500 }
  ],
  destructive: true
} satisfies BrandEndpoint;

export type CreateShareInput = z.infer<typeof CREATE_SHARE.input>;
export type CreateShareResult = z.infer<typeof CREATE_SHARE.output>;
