-- Vault secret wrappers must never be callable by anon/authenticated. They already guard
-- internally (RAISE unless service_role/postgres), and are only ever invoked with the
-- service-role admin client — so strip the redundant EXECUTE grants for least-privilege.
-- (A broad `revoke ... on all functions from anon, authenticated` had earlier stripped grants
--  app-wide; this pins the intended state for these three functions.)
revoke execute on function public.read_integration_secret(uuid, text)          from public, anon, authenticated;
revoke execute on function public.upsert_integration_secret(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_integration_secret(uuid, text)        from public, anon, authenticated;

grant execute on function public.read_integration_secret(uuid, text)          to service_role;
grant execute on function public.upsert_integration_secret(uuid, text, jsonb) to service_role;
grant execute on function public.delete_integration_secret(uuid, text)        to service_role;
