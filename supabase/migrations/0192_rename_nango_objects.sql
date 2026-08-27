-- 0192 — Finish the rename: the objects Postgres kept named after Nango.
--
-- `alter table … rename` leaves indexes, constraints and policies with their old names, so
-- brand_app_connections still carried brand_nango_connections_pkey and a policy called "nango
-- connections via brand". Cosmetic, but the next person reading the schema should not have to
-- work out which broker the names refer to. No data or behaviour changes here.

alter table public.brand_app_connections
  rename constraint brand_nango_connections_pkey to brand_app_connections_pkey;
alter table public.brand_app_connections
  rename constraint brand_nango_connections_brand_id_nango_integration_id_key
  to brand_app_connections_brand_id_toolkit_slug_key;
alter table public.brand_app_connections
  rename constraint brand_nango_connections_kind_check to brand_app_connections_kind_check;
alter table public.brand_app_connections
  rename constraint brand_nango_connections_brand_id_fkey to brand_app_connections_brand_id_fkey;

alter index public.brand_nango_connections_brand_idx rename to brand_app_connections_brand_idx;

alter table public.app_integration_registry
  rename constraint nango_integration_registry_pkey to app_integration_registry_pkey;
alter table public.app_integration_registry
  rename constraint nango_integration_registry_kind_check to app_integration_registry_kind_check;

alter policy "nango connections via brand" on public.brand_app_connections
  rename to "app connections via brand";
