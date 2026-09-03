# stripe.ts was the same stub as anomalia-provider.ts

`src/lib/server/stripe.ts` was `throw new Error('not available in the open build')` since this
repo's first commit — the same shape already fixed once in `anomalia-provider.ts` (PR #161). It's
the only import in `src/lib/server/settings-actions.ts`, inside `billingPortal()`, `upgrade()`,
`applyRetention()`, `cancelPlan()` and `deleteBrand()`. Every one of those wraps the call in a
`try/catch` that returns `fail(500, { billingError: e.message })` — so a brand owner clicking
"manage billing" or "upgrade" got a form-action failure carrying the literal string
"not available in the open build". Confirmed the same way as #161: one commit in `git log --all`
for the file, no private dependency, no build alias, no script that ever wrote real content into
it.

`settings-actions.ts` already fully specifies the five functions' contracts (parameter names,
return shapes) — none of that changed. Implemented against the real `stripe` npm package
(newly added dependency, `^22.6.1` — none existed before):

- `createBillingPortalSession` / `createUpgradePortalSession` call
  `stripe.billingPortal.sessions.create`, using Stripe's hosted Customer Portal `flow_data`
  (`payment_method_update`, `subscription_update`, `subscription_update_confirm`) — no proration,
  dunning, or retry logic written here, because none of that lives in this codebase: it's
  Dashboard configuration on the Customer Portal itself, unchanged.
- `applyRetentionCoupon` / `cancelSubscriptionAtPeriodEnd` call `stripe.subscriptions.update`
  directly (coupon, `cancel_at_period_end` + `cancellation_details`).
- `ensureSubscriptionCanceled` reads the subscription's `status` and throws `'active_plan'`
  (mapped by `deleteBrand` to `deleteError: 'activePlan'`) unless it's already `canceled` — it
  never cancels a subscription as a side effect of a brand delete.

**New env vars needed to fully activate `upgrade()`:** `STRIPE_PRICE_GO`, `STRIPE_PRICE_STARTER`,
`STRIPE_PRICE_PRO` — the Stripe Price ids for each plan, mapped by
`priceIdForPlan()`. Nothing in this repo held that mapping before (no code, no env var), and this
fix can't discover it from Stripe's API for the right account from here — until they're set,
`createUpgradePortalSession` throws a clear "No Stripe price configured for plan …" instead of
crashing on an undefined lookup, and `billingPortal()`/`applyRetention()`/`cancelPlan()`/
`deleteBrand()` are unaffected (they only need `STRIPE_SECRET_KEY`, already set on Vercel).

**Scope**: brand-level, exactly as `settings-actions.ts` already reads/writes `brands.*` today.
Repointing this at the org-level billing migration (wayfinder map #183) is separate, later work.

**Discarded**: querying Stripe live for the plan → Price id mapping instead of an env var. The
Stripe MCP connection available in this session is a different account (`leads.anomalia`, not the
production Anomalia SaaS account) — querying it would have returned the wrong catalogue entirely.
