-- 0048: backward-compatible GTM schema sync.
--
-- Some environments are still on 0036's single `phases` column with a source check that predates
-- onboarding-created plans, while the app code reads the dual-horizon columns (phases_90d / phases_6m)
-- and writes source = 'onboarding'. This migration reconciles them WITHOUT a destructive rename:
--   • additively add phases_90d / phases_6m (no-op where 0042 already created them),
--   • backfill phases_90d from the legacy `phases` column when it still exists,
--   • allow source = 'onboarding' (already allowed on editorial_plans).
-- It is idempotent and safe to run on 0036-state and 0042-state databases alike. The legacy `phases`
-- column is intentionally kept (not dropped) so any code path still reading it keeps working.

alter table public.gtm_plans add column if not exists phases_90d jsonb not null default '[]'::jsonb;
alter table public.gtm_plans add column if not exists phases_6m  jsonb not null default '[]'::jsonb;

-- Backfill phases_90d from the legacy `phases` column where it still exists and 90d is still empty.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gtm_plans' and column_name = 'phases'
  ) then
    execute $backfill$
      update public.gtm_plans
      set phases_90d = phases
      where (phases_90d is null or phases_90d = '[]'::jsonb)
        and phases is not null and phases <> '[]'::jsonb
    $backfill$;
  end if;
end $$;

-- Allow onboarding-created GTM plans (mirrors editorial_plans_source_check, which already permits it).
alter table public.gtm_plans drop constraint if exists gtm_plans_source_check;
alter table public.gtm_plans add constraint gtm_plans_source_check
  check (source in ('manual', 'revision', 'phase_review', 'onboarding'));
