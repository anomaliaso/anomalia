-- 0177 — Lock in "brand users never see an unpublished integration".
--
-- The registry is operator data: which Nango unique keys exist, whether each is an App or an MCP,
-- and whether it is published. 0175 enabled RLS and deliberately shipped no policy, so a user
-- session reads nothing at all — the strongest possible rule, and we keep it that way. Every read
-- path goes through the service-role client, which bypasses RLS; the `visible` filter that protects
-- brand pages therefore lives in catalogForViewer() (src/lib/nango-catalog.ts), not here.
--
-- Do NOT add a `for select using (visible)` policy: nothing needs it, and it would turn a table no
-- user can read into one every user can enumerate. Flip kind/visible with SQL or the service key.

comment on table public.nango_integration_registry is
  'Operator-only Nango catalog (kind + visible). RLS is deny-all on purpose: no policy, ever. '
  'Server reads it with the service-role client and filters on visible before rendering.';

do $$
declare n int;
begin
  select count(*) into n from pg_policy
    where polrelid = 'public.nango_integration_registry'::regclass;
  if n > 0 then
    raise exception 'nango_integration_registry must have no RLS policy (found %)', n;
  end if;
end $$;
