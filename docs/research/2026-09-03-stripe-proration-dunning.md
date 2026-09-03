# Stripe proration, dunning, and tax/currency — API reference research

Issue: [#188](https://github.com/anomaliaso/anomalia/issues/188), child of the org-level
billing migration epic ([#183](https://github.com/anomaliaso/anomalia/issues/183)).

Scope: this is pure research. No product decisions are made here — those are deferred to
[#189](https://github.com/anomaliaso/anomalia/issues/189). Every claim below is sourced from
Stripe's own documentation (fetched live via the Stripe MCP tools, not training data), with the
exact API/parameter name and a doc URL per claim.

## (a) Proration on a mid-period plan change

Source: [Prorations](https://docs.stripe.com/billing/subscriptions/prorations),
[Change the price of existing subscriptions](https://docs.stripe.com/billing/subscriptions/change-price),
[Migrate subscriptions to Stripe Billing using toolkit](https://docs.stripe.com/billing/subscriptions/import-subscriptions-toolkit).

- `proration_behavior` is a parameter on both [update Subscription](https://docs.stripe.com/api/subscriptions/update#update_subscription-proration_behavior)
  and [update Subscription Item](https://docs.stripe.com/api/subscription_items/update). Three
  values:
  - `create_prorations` (default) — Stripe generates proration invoice items immediately but
    defers billing them to the next regularly scheduled invoice (or the current draft invoice, if
    one is open).
  - `none` — disables proration. No proration invoice items are created for the change.
  - `always_invoice` — computes the proration, then immediately generates and finalizes an
    invoice for the difference right after the change (draft invoice auto-finalizes after one
    hour). Documented use case: bill a customer immediately for a same-billing-period change.

- **What triggers a proration by default** (per the "What triggers prorations" table in the
  Prorations doc):
  - Changing `items` — adding a new subscription item or removing an existing one
  - Changing an item's `price` — moving to a price with a different base cost or interval
  - Changing an item's `quantity` — increasing or decreasing
  - Adding `trial_end` or `trial_from_plan` to an active subscription
  - Changing `billing_cycle_anchor` — resets the billing period
  - Setting `cancel_at` to cancel mid-period (not at period end)

- **What does NOT trigger a proration** (explicit table in the same doc): `automatic_tax`,
  `default_payment_method`, `default_source`, `payment_behavior`, `collection_method`,
  `days_until_due`, `tax_filing_currency`, `retry_settings`, `trial_settings`,
  `pay_immediately`, `pending_invoice_item_interval`, `pause_collection`, `proration_date` (by
  itself), `metadata`/`items.metadata`, `cancellation_details`, `discounts`/`items.discounts`,
  `billing_thresholds`/`items.billing_thresholds`, `cancel_at_period_end`, `add_invoice_items`.
  Updating only a discount/coupon on a subscription does not itself create a proration; only
  changes that alter the billable amount for the current period do.

- **`proration_date`** — [update Subscription param](https://docs.stripe.com/api/subscriptions/update#update_subscription-proration_date).
  Doesn't create prorations by itself; it sets the specific timestamp used *when* a proration is
  otherwise triggered, letting you override "now" as the split point between old and new pricing.

- **Multi-item subscriptions**: prorations are computed per subscription item that changed
  (price, quantity, add/remove). Discounts/coupons at the subscription level apply to the
  discounted price used for computing the proration if changed in the *same* API call that
  triggers the proration; otherwise a discount-only change is not itself a proration trigger. Note
  proration credit/debit for `discountable=false` items on the proration line items — no further
  discount applies to the proration line item itself.
  ("Prorations and discounts" section, same doc.)

- **Manual/custom prorations**: to compute your own proration outside Stripe, pass
  `add_invoice_items` with a negative `unit_amount` to `CreateSubscription`, `UpdateSubscription`,
  `CreateSubscriptionSchedule`, or `UpdateSubscriptionSchedule`.

- **Time granularity**: Stripe prorates to the second by default. Coarser granularity (hour/day/
  week/month) requires a **Stripe-authored Billing script** ("Prorate by custom interval"),
  configured account-wide in Dashboard → Settings → Billing → Billing customizations, not via a
  per-subscription API param. There is also a "Credit and debit full product price" script to
  exempt specific products (tagged via product metadata) from proration entirely.

- **`billing_mode` interacts with proration mechanics**: subscriptions have a `billing_mode` of
  `flexible` or `classic`
  ([Enable increased flexibility for subscriptions](https://docs.stripe.com/billing/subscriptions/billing-mode)).
  Default is `flexible` for API version `2025-09-30.clover`+ and Dashboard-created subscriptions
  (configurable), `classic` for older API versions. Flexible mode changes proration math (credit
  prorations use the *original debited amount* rather than recalculating against current
  subscription state), billing-cycle-anchor behavior (never auto-resets on flexible), and
  usage-based billing charge timing. A `flexible` subscription cannot be migrated back to
  `classic`.

- **Quantity change specifically**: replacing an item's `price` on update resets that item's
  `quantity` to the default of `1` unless you explicitly pass the existing quantity in the same
  update call
  ([Change the price of existing subscriptions](https://docs.stripe.com/billing/subscriptions/change-price)).
  Relevant for a "quantity = brand count" per-item billing shape: every price change on that item
  must re-supply quantity or it silently resets to 1.

- **Preview before applying**: proration amounts can be previewed via the invoice preview
  endpoint before committing the subscription update (same doc, "preview a proration").

## (b) Dunning / failed-payment retry policy

Source: [Revenue recovery](https://docs.stripe.com/billing/revenue-recovery),
[Automate payment retries (Smart Retries)](https://docs.stripe.com/billing/revenue-recovery/smart-retries),
[Billing collection methods](https://docs.stripe.com/billing/collection-method),
[How automations work](https://docs.stripe.com/billing/automations).

- **Smart Retries** is Stripe's AI-scheduled retry system for subscription/recurring invoice
  payments. Configured in Dashboard → **Revenue Recovery** (`dashboard.stripe.com/revenue_recovery/retries`),
  not via a subscription-level API parameter. You set a policy: retry N times within a window of
  1 week / 2 weeks / 3 weeks / 1 month / 2 months. **Recommended default: 8 tries within 2 weeks.**
  Smart Retries uses signals (device/payment-method patterns, time-of-day success rates, card
  network processing patterns) rather than a fixed schedule.

- **Custom retry schedule** (opt-out of AI retries): configurable in the same Dashboard page —
  up to **3 retry attempts**, each a specific number of days after the previous attempt (docs
  mention up to 9 days between attempts for the off-session-payments variant; the Billing/
  subscriptions variant is "up to three retries, each with a specific number of days after the
  previous attempt").

- **After retries are exhausted**, subscription behavior is controlled by a Dashboard setting
  (Settings → Billing → Subscriptions and emails / automatic-collection settings) with three
  options:
  - **Cancel the subscription** — subscription → `canceled`
  - **Mark the subscription as unpaid** — subscription → `unpaid`; Stripe continues generating
    invoices, but they stay in `draft`
  - **Leave the subscription past-due** — subscription stays `past_due`; invoices continue to be
    generated and charged per retry settings
  - After the final attempt, Stripe makes no further payment attempts unless settings change
    (which only affects *future* retries, not the already-exhausted invoice).

- **`payment_behavior`** — [create/update Subscription param](https://docs.stripe.com/api/subscriptions/create#create_subscription-payment_behavior).
  Documented values and effects (from "Billing collection methods"):
  - `allow_incomplete` + `collection_method=charge_automatically` — attempts payment immediately;
    if it fails, subscription `status` is set to `incomplete` rather than blocking creation.
  - `default_incomplete` — always initializes the subscription as `incomplete` if the first
    invoice requires payment; the resulting PaymentIntent must be confirmed in a separate request.
  - Both `allow_incomplete` and `default_incomplete` transition the subscription to `active` once
    the first invoice is paid. If unpaid after **23 hours**, subscription → `incomplete_expired`
    (final/irreversible; voids the open invoice, prevents future invoices).
  - Subscriptions that don't require payment at creation (e.g. trialing) go straight to `active`.

- **Recurring-charge failure lifecycle** (not the first invoice — an ongoing renewal):
  - Payment fails, or requires authentication → subscription `status` → `past_due`, and the
    PaymentIntent status is `requires_payment_method` or `requires_action`.
  - Recommended integration: listen to `customer.subscription.updated`
    ([event type](https://docs.stripe.com/api/events/types#event_types-customer.subscription.updated))
    to detect the `past_due` transition.
  - `invoice.payment_failed` ([event type](https://docs.stripe.com/api/events/types#event_types-invoice.payment_failed))
    fires on each failed payment attempt for monitoring/retry-attempt tracking. The invoice's
    `next_payment_attempt` field reflects the next scheduled retry using the account's current
    retry settings — **caveat**: "when using automations, `next_payment_attempt` is no longer set
    in `invoice.payment_failed` webhooks but is set in `invoice.updated` webhooks" instead.
  - After Stripe exhausts retries: subscription transitions to `canceled`/`unpaid`/`past_due` per
    the Dashboard setting above (Automatic collection settings) — same as the Revenue Recovery
    section.
  - `collection_method=send_invoice` subscriptions follow a parallel but distinct path: they go
    `past_due` when the invoice passes its due date (not on card-decline retries), and follow the
    same terminal-state Dashboard setting after the deadline lapses.

- **No-code Automations** ([How automations work](https://docs.stripe.com/billing/automations)):
  a rules engine layered on top of the above, letting you define per-condition dunning policies
  (e.g. "if invoice > $100 and payment fails, cancel subscription" vs. the account-wide default).
  Actions include: Set retry policy, Mark subscription unpaid, Cancel subscription, Mark invoice
  uncollectible, Send team email, Send subscription cancellation email, Send
  `invoice.will_be_due` webhook. Automations are prioritized in an explicit order; the first
  matching automation for an event wins and the account-wide default is skipped for that event.

- **Local payment methods** (ACH, ACSS, BECS, Bacs, SEPA Direct Debit) have separate,
  non-AI "heuristic" retry rules with fixed max-retries/max-window pairs (e.g. ACH: 2 retries /
  40 days; SEPA: 2 retries / 30 days) — off by default, toggled in the same Revenue Recovery
  settings page. Hard-decline codes (e.g. `lost_card`, `stolen_card`, `authentication_required`)
  are never retried regardless of policy.

- **Configuration surface, summarized**: Smart Retries policy, custom retry schedule, and the
  post-exhaustion subscription-state setting are all **Dashboard-only settings**
  (`dashboard.stripe.com/revenue_recovery/retries`, `dashboard.stripe.com/settings/billing/automatic`)
  — there is no subscription-level API field to set the retry count/window per subscription; the
  account-wide policy applies, unless overridden per-event by a no-code Automation.

## (c) Multi-currency and tax handling

Source: [Set up Stripe Tax](https://docs.stripe.com/tax/set-up),
[Collect taxes for recurring payments](https://docs.stripe.com/tax/subscriptions),
[How Stripe Tax works](https://docs.stripe.com/tax/how-tax-works),
[Manage products and prices — multi-currency](https://docs.stripe.com/products-prices/manage-prices),
[Customers — currency](https://docs.stripe.com/billing/customer).

**Tax**

- `automatic_tax` is **off by default** and must be explicitly enabled per object. On the
  Subscription object: `automatic_tax[enabled]=true`
  ([create](https://docs.stripe.com/api/subscriptions/create#create_subscription-automatic_tax-enabled)
  / [update](https://docs.stripe.com/api/subscriptions/update#update_subscription-automatic_tax-enabled)).
  Same pattern exists on Invoices, Checkout Sessions, and Payment Links.
- Enabling `automatic_tax` alone is not sufficient for tax to actually be calculated/collected:
  Stripe Tax **only collects tax in jurisdictions where you have an active registration**
  (Dashboard → Tax → Registrations, or the [Tax Registrations API](https://docs.stripe.com/api/tax/registrations/create)).
  If no registration covers the customer's resolved jurisdiction, `tax` computes to `0` silently
  (no error) — confirmed by the "Zero tax" callout in the Collect taxes for recurring payments
  doc.
  There is also a required **origin/head-office address** configured in Tax settings.
- Enabling `automatic_tax` on an *existing* subscription does not retroactively apply — an
  existing subscription/invoice/payment-link instance must be individually updated (Dashboard or
  `automatic_tax[enabled]=true` via its own update API) to start calculating/collecting tax going
  forward.
- Stripe Tax is priced per calculated transaction where an active registration applies to the
  jurisdiction — i.e. turning it on has a direct, measurable per-renewal cost once registrations
  exist ([How Stripe Tax works — pricing](https://docs.stripe.com/tax/how-tax-works)); trial-period
  ($0) invoices are not charged a tax fee.
- Customer location/address quality gates tax accuracy: outside the US requires at least a
  country-level address; US requires 5-digit postal code; Canada requires province or postal
  code. `customer.tax.validate_location=immediately` on Customer create/update can hard-fail
  request with `customer_tax_location_invalid` if the address doesn't resolve.
- Products/Prices need a `tax_behavior` (`inclusive`/`exclusive`, immutable once set — a new
  price must be created to change it) and optionally a `tax_code`.
- Proration, discounts, and trials are documented as automatically compatible with Stripe Tax
  when `automatic_tax` is enabled — "Stripe Tax integrates with Stripe Billing and automatically
  handles tax calculation with your pricing model, prorations, discounts, trials, and so on."

**Multi-currency**

- A **Customer's `currency`** is set once (explicitly, or implicitly the first time an invoice/
  invoice-item/credit-balance is created for them) and **cannot be changed afterward**
  ([Customers — Set the currency for a customer](https://docs.stripe.com/billing/customer)).
  This is the practical constraint for "one org, one subscription, unlimited brands": the org's
  Stripe Customer has exactly one billing currency for the life of that Customer object.
- **Prices** can be multi-currency: a Price has one default `currency` plus a `currency_options`
  map of additional supported currencies
  ([Manage products and prices — multi-currency](https://docs.stripe.com/products-prices/manage-prices)).
  All Prices used together in one purchase/session must share the same *default* currency.
- **How a Subscription picks its currency depends on how it's created**:
  - Checkout: auto-detects customer's local currency from IP, if the Price supports it; falls back
    to the Price's default currency otherwise, or accept an explicit `currency` override.
  - Direct API subscription creation (Stripe Elements / server-side): the subscription uses the
    Price's *default* currency unless you explicitly pass the `currency` parameter on
    [create Subscription](https://docs.stripe.com/api/subscriptions/create#create_subscription-currency).
  - Subscription Schedules: `phases.currency` selects which supported currency a phase uses; if
    omitted, the schedule/subscription uses the Price's default currency.
  - Quotes do not support multi-currency Prices at all — always use the default currency.
- **Rounding**: for multi-currency/decimal unit amounts, rounding happens per invoice line item
  (quantity × decimal unit amount rounds up to the smallest currency unit per line, then lines
  sum) — documented in the same "Rounding" section.

**Verdict on whether multi-currency is a decision needed now**: Stripe's default behavior for a
directly API-created subscription (no Checkout, no multi-currency Price) is a single fixed
currency per Customer for that Customer's entire lifetime, inherited from the Price's default
currency unless overridden. Nothing in Stripe's model *forces* a currency decision before
building single-currency org subscriptions — multi-currency is an explicit, additive opt-in
(`currency_options` on Price + `currency` param at subscription-creation time), not something
that leaks in by default.

## Open questions for #189 (product decision ticket)

Stripe supports the following; Anomalia still needs to choose:

1. Whether org-level "add a brand" / "remove a brand" maps to a subscription **item quantity
   change** on one recurring price, or to **adding/removing distinct subscription items** (one
   line item per brand) — both trigger proration by default, but have different implications for
   per-brand entitlement tracking and invoice readability.
2. Which `proration_behavior` to use for brand add/remove: `create_prorations` (bill on next
   cycle) vs `always_invoice` (bill immediately) vs `none` (absorb the cost until renewal).
3. Whether to adopt `billing_mode=flexible` (recommended by Stripe, required for some newer
   proration/usage-based accuracy improvements and mixed-interval subscriptions) vs `classic`,
   given this is a new migration with no legacy subscriptions to preserve compatibility for.
4. Smart Retries policy window (Stripe recommends 8 tries / 2 weeks) vs a custom schedule, and
   whether to use it as-is or fine-tune via account-wide Dashboard settings (there's no
   per-subscription override without building a no-code Automation).
5. Post-retry-exhaustion behavior for an org subscription: `canceled` vs `unpaid` vs left
   `past_due` — this has direct product implications (does the whole org lose access to every
   brand, or does billing just stay open while brands remain usable?).
6. Whether/when to enable Stripe Tax (`automatic_tax`) for org subscriptions, and which tax
   registrations to add — this is a compliance decision, not just a technical toggle, since
   registrations must be added per jurisdiction before tax is actually collected there.
7. Whether Anomalia needs multi-currency subscriptions at all in the near term, or can defer to
   Stripe's default single-currency-per-Customer behavior — Stripe doesn't require the decision
   now, but the org-level Customer's currency, once set, is permanent.
