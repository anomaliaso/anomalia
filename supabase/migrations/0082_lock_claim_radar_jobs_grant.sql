-- claim_radar_jobs mutates the radar_jobs queue (SECURITY INVOKER, no internal guard) and is only
-- ever called by the service-role admin client (api/v1/radar/work). anon/authenticated never call
-- it; their EXECUTE grant (re-added during a blanket grant restore) is pure over-privilege, and the
-- only thing currently stopping an anon caller is radar_jobs having RLS-with-no-policy. Revoke it.
--
-- SELF-HOST: la funzione esiste solo dove l'ha creata il prodotto hosted (fuori dai migration).
-- Su un Supabase proprio i grant non hanno oggetto: il DO-block li salta senza fermare il giro.
do $$
begin
  if to_regprocedure('public.claim_radar_jobs(integer, timestamptz)') is not null then
    execute 'revoke execute on function public.claim_radar_jobs(integer, timestamptz) from public, anon, authenticated';
    execute 'grant execute on function public.claim_radar_jobs(integer, timestamptz) to service_role';
  end if;
end $$;
