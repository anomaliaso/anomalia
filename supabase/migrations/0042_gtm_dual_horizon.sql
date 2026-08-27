-- 0042: GTM dual-horizon — the plan now generates both 90-day and 6-month views in a single
-- generation. The segmented control switches client-side without re-generating. Drop 1y/2y.
-- Rename existing phases column to phases_90d, add phases_6m.
alter table public.gtm_plans rename column phases to phases_90d;
alter table public.gtm_plans add column phases_6m jsonb not null default '[]'::jsonb;
-- Update horizon constraint: only 90d and 6m allowed.
alter table public.gtm_plans drop constraint if exists gtm_plans_horizon_check;
alter table public.gtm_plans add constraint gtm_plans_horizon_check
  check (horizon in ('90d', '6m'));
