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

`settings-actions.ts` already fully specifies the functions' contracts (parameter names, return
shapes) — none of that changed. Implemented against the real `stripe` npm package (newly added
dependency, `^22.6.1` — none existed before):

- `createBillingPortalSession` calls `stripe.billingPortal.sessions.create`, using Stripe's hosted
  Customer Portal `flow_data` (`payment_method_update`, `subscription_update`) — no proration,
  dunning, or retry logic written here, because none of that lives in this codebase: it's
  Dashboard configuration on the Customer Portal itself, unchanged.
- `applyRetentionCoupon` / `cancelSubscriptionAtPeriodEnd` call `stripe.subscriptions.update`
  directly (`discounts`, `cancel_at_period_end` + `cancellation_details`).
- `ensureSubscriptionCanceled` throws `'active_plan'` (mapped by `deleteBrand` to
  `deleteError: 'activePlan'`) only while the subscription can still charge someone — it never
  cancels a subscription as a side effect of a brand delete.

Two defects in the first pass, both invisible to tests that mock the SDK, both found by review:

**`coupon` no longer exists on a subscription update.** `stripe@22.6.1` pins API
`2026-08-26.dahlia`, where the parameter became `discounts: [{ coupon }]`; the old spelling
compiles to `TS2353: 'coupon' does not exist in type 'SubscriptionUpdateParams'` and would have
been a 400 "unknown parameter" at runtime — so the retention offer never worked. The test now
asserts the parameter's real shape rather than that *some* update was called, which is the only
version of it that could have failed.

**`status === 'canceled'` was the wrong question.** The right one is "can this still charge
someone". An owner who had just used "cancel plan" carries `cancel_at_period_end` with the status
still `active`: the UI told them they had cancelled, and the delete refused for up to a month.
A subscription id Stripe no longer knows was worse — `retrieve` throws `resource_missing`,
`deleteBrand` mapped that to a generic failure, and the brand became undeletable forever. Both now
pass, along with the settled `unpaid`/`incomplete_expired` states. `past_due` and `incomplete`
deliberately still refuse: they recover on a retry, and cancelling is one click away. Every other
Stripe failure still refuses too — failing open on a network or auth error would delete a brand
whose subscription is very much alive.

**Every plan change happens in Stripe's portal, on the prices configured there.** A first pass
mapped each plan to a Stripe Price id through `STRIPE_PRICE_GO`/`STARTER`/`PRO` env vars and
opened the portal's `subscription_update_confirm` flow already pointed at that price. Andrea's
rule is narrower and simpler: the upgrade *is* the portal. So the app names no price at all — it
opens the plain `subscription_update` flow and the customer picks there, from the catalogue the
Stripe dashboard already defines. Three env vars that never existed stay non-existent, and the
plan ladder can be re-priced in Stripe without a deploy.

That collapsed `createUpgradePortalSession` into exactly what `createBillingPortalSession` with
`flow: 'upgrade'` already did, so it is gone rather than kept as a second name for one behaviour;
`upgrade()` calls the surviving function. The `plan` value it reads from the form still gates the
action (`plansAbove`) and still rides the `/activate` redirect for a brand with no subscription
yet — it just no longer reaches Stripe.

**Scope**: brand-level, exactly as `settings-actions.ts` already reads/writes `brands.*` today.
Repointing this at the org-level billing migration (wayfinder map #183) is separate, later work.
