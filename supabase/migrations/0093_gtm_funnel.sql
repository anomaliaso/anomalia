-- 0093 gtm_plans.funnel: the explicit FunnelSpec driving the plan's numeric targets —
-- { final: { metric, value }, rates: { reach_to_click, click_to_signup, signup_to_active } }.
-- The spec is the single source of truth for every number in the phases' code-stamped goals
-- (see src/lib/server/funnel.ts): visible, readable, and editable — never numbers hidden in
-- prose. The rates are labelled assumptions ("ipotesi"), not guarantees. Null (every existing
-- plan) → no funnel layer: behaviour identical to before.
alter table public.gtm_plans add column if not exists funnel jsonb;
