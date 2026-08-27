-- 0190 — Composio replaces Nango as the connector broker.
--
-- Same shape, vendor-neutral names: an integration is now a Composio toolkit slug and a
-- connection is a Composio connected account. Composio holds the credentials — we only ever
-- store its account id, exactly as we only stored Nango's connection id before.
--
-- Nango connection ids mean nothing to Composio, so every live row is marked for reconnect
-- instead of being left pointing at a dead broker. Rows and ingested documents are preserved:
-- reconnecting the same provider reuses the row and its scope settings.

-- ── Registry: which toolkits brands may see ──────────────────────────────
alter table if exists public.nango_integration_registry rename to app_integration_registry;
alter table if exists public.app_integration_registry rename column unique_key to toolkit_slug;

delete from public.app_integration_registry
  where toolkit_slug in ('google-drive', 'notion', 'github-app', 'google-mail',
                         'supabase-mcp-oauth', 'canva-mcp');

insert into public.app_integration_registry (toolkit_slug, kind, visible)
values
  ('GOOGLEDRIVE', 'app', true),
  ('NOTION', 'app', true),
  ('GITHUB', 'app', true),
  ('GMAIL', 'app', true),
  ('SUPABASE', 'mcp', true),
  ('CANVA', 'mcp', true)
on conflict (toolkit_slug) do nothing;

-- ── Brand connections ────────────────────────────────────────────────────
alter table if exists public.brand_nango_connections rename to brand_app_connections;
alter table if exists public.brand_app_connections
  rename column nango_integration_id to toolkit_slug;
alter table if exists public.brand_app_connections
  rename column nango_connection_id to connected_account_id;

-- A connection is 'pending' between "user opened the Connect Link" and "Composio says ACTIVE";
-- the browser and the CLI both poll that state instead of waiting on a callback.
alter table public.brand_app_connections
  drop constraint if exists brand_nango_connections_status_check;
alter table public.brand_app_connections
  add constraint brand_app_connections_status_check
  check (status in ('active', 'pending', 'error', 'disconnected'));

update public.brand_app_connections
   set status = 'error',
       last_error = 'Reconnect: connectors moved to Composio.',
       updated_at = now()
 where status <> 'disconnected';

-- ── Knowledge sources ────────────────────────────────────────────────────
alter table if exists public.brand_knowledge_sources
  rename column nango_connection_id to connected_account_id;
alter table if exists public.brand_knowledge_sources
  rename column nango_integration_id to toolkit_slug;

update public.brand_knowledge_sources
   set status = 'error',
       last_error = 'Reconnect: connectors moved to Composio.',
       updated_at = now()
 where status <> 'disconnected';

-- Ingest never runs against a broker that cannot authenticate the call: the sync worker only
-- picks up 'pending_sync' rows, so the reconnect above also parks ingestion until it happens.
