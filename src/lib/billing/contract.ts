// The billing contract: what "can this brand keep going" means, decoupled from who answers it.
//
// Two providers implement it — open-provider.ts (this file's neighbour, the default: permits
// everything, for a self-hosted fork) and the paid product's actual credit/quota/payment logic,
// server-only, unchanged, just wrapped behind this same shape. A server-side selector picks one.
//
// This file must stay importable from the browser: no server-only imports, no secrets, no
// payment-provider SDK — enforced by contract.test.ts, which reads this file as text.

export type QuotaKind = 'credits' | 'posts';

export type BillingContext = {
  /** Absent on work asked for WITHOUT a brand — then `orgId` names who pays. One of the two is always set. */
  brandId?: string;
  /** The organization that pays when no brand does. Unread while a brandId is here: a brand reaches its own org. */
  orgId?: string;
  /** Not always known by the caller (e.g. the credits chokepoint only has a brandId) — optional. */
  plan?: string | null;
  brandSlug?: string;
};

/** Mirrors server/credits.ts's CreditsUsage + server/usage.ts's post counters, provider-agnostic. */
export type BillingUsage = {
  creditsUsed: number;
  creditsQuota: number; // Infinity under the open provider
  creditsRemaining: number; // Infinity under the open provider
  postsUsed: number;
  postsQuota: number; // Infinity under the open provider
  postsRemaining: number; // Infinity under the open provider
};

export type UpgradeOption = {
  key: string;
  label: string;
  posts: number;
  accounts: number;
  radarSources: number;
};

/**
 * Thrown by a gate() denial that isn't already covered by an existing typed error. Credits keep
 * throwing server/credits.ts's own CreditsExhaustedError (unchanged — ~20 call sites already
 * match it by `.name`, and duplicating it here would just be a second class with the same job).
 * QuotaExceededError is that same cross-boundary-by-`.name` convention for every other kind.
 */
export class QuotaExceededError extends Error {
  constructor(
    public kind: QuotaKind,
    public usage?: BillingUsage
  ) {
    super(`${kind} exhausted for this billing period`);
    this.name = 'QuotaExceededError';
  }
}

export class PlanRequiredError extends Error {
  constructor(public requiredPlan: string) {
    super(`plan ${requiredPlan} or above required`);
    this.name = 'PlanRequiredError';
  }
}

export interface BillingProvider {
  readonly kind: 'open' | 'anomalia';

  /** Throws (CreditsExhaustedError for 'credits', QuotaExceededError otherwise) when denied. */
  gate(kind: QuotaKind, ctx: BillingContext): Promise<void>;

  /** Ceiling for a quota kind. Infinity under the open provider — drives server/usage.ts remaining(). */
  quota(kind: QuotaKind, ctx: BillingContext): Promise<number>;

  /** Where to send the user to pay for more. undefined when there's nothing to sell. */
  upgradeUrl(ctx: BillingContext): string | undefined;

  /** Plans strictly above the current one, for upsell UI. [] when there's nothing to sell. */
  plansAbove(plan: string | null | undefined): UpgradeOption[];

  /** Already at the top — or the open provider, which has no ceiling to sell past. */
  isTopPlan(plan: string | null | undefined): boolean;
}
