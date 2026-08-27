-- 0091: drop the deprecated gtm_plans.phases_90d / phases_6m columns.
--
-- The single source of truth for GTM phases is the `phases` jsonb column, holding the dual object
-- { horizon_90d, horizon_6m } (or a legacy single-horizon array). gtm.ts/gtmRowToPlan and every
-- reader now parse `phases` exclusively. The split phases_90d/phases_6m columns were only ever
-- mirrored by the onboarding writer for the old sidebar checklist and read by the brand layout —
-- both now consolidated on `phases`. That divergence is what made plans activated via activateGtm
-- (data in `phases`, split columns still empty '[]') show "strategy to do" in the sidebar/home.
--
-- Defensive backfill first (verified 0 rows rely solely on the split columns at authoring time; this
-- guards any row an in-flight old deploy may insert), then drop. Idempotent.
--
-- SELF-HOST: su un replay pulito `phases` non esiste più (0042 l'ha rinominata in phases_90d) e
-- nessun migration la ricrea — l'hosted ce l'ha perché fu riaggiunta fuori banda. Questo file è il
-- punto dove `phases` torna a essere la sorgente unica, quindi è qui che va creata se manca.
alter table public.gtm_plans add column if not exists phases jsonb not null default '[]'::jsonb;

do $$
begin
  if to_regclass('public.gtm_plans') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gtm_plans' and column_name = 'phases_90d'
  ) then
    execute $upd$
      update public.gtm_plans
      set phases = jsonb_build_object(
          'horizon_90d', coalesce(phases_90d, '[]'::jsonb),
          'horizon_6m',  coalesce(phases_6m, '[]'::jsonb)
        )
      where (
          phases is null
          or (jsonb_typeof(phases) = 'array' and jsonb_array_length(phases) = 0)
          or (jsonb_typeof(phases) = 'object'
              and coalesce(jsonb_array_length(phases->'horizon_90d'), 0) = 0
              and coalesce(jsonb_array_length(phases->'horizon_6m'), 0) = 0)
        )
        and (
          coalesce(jsonb_array_length(phases_90d), 0) > 0
          or coalesce(jsonb_array_length(phases_6m), 0) > 0
        );
$upd$;
  end if;
end $$;

alter table public.gtm_plans drop column if exists phases_90d;
alter table public.gtm_plans drop column if exists phases_6m;
