-- 0191 — Normalize the toolkit slugs left behind by 0190.
--
-- 0190 renamed the column but not its values: rows carried over from Nango still hold the old
-- unique keys ('notion', 'github-app'). The code addresses toolkits by upper-case Composio slug,
-- so a reconnect would insert a second row for the same brand + provider and leave the legacy
-- one showing as a permanent error in Settings → Connectors and in `anomalia connections`.

update public.brand_app_connections
   set toolkit_slug = case lower(toolkit_slug)
         when 'google-drive' then 'GOOGLEDRIVE'
         when 'notion' then 'NOTION'
         when 'github-app' then 'GITHUB'
         when 'github' then 'GITHUB'
         when 'google-mail' then 'GMAIL'
         when 'supabase-mcp-oauth' then 'SUPABASE'
         when 'canva-mcp' then 'CANVA'
         else upper(replace(toolkit_slug, '-', '_'))
       end,
       updated_at = now()
 where toolkit_slug <> upper(toolkit_slug) or toolkit_slug like '%-%';

update public.brand_knowledge_sources
   set toolkit_slug = case provider
         when 'google-drive' then 'GOOGLEDRIVE'
         when 'notion' then 'NOTION'
         when 'github' then 'GITHUB'
         when 'google-mail' then 'GMAIL'
         else upper(replace(toolkit_slug, '-', '_'))
       end,
       updated_at = now()
 where toolkit_slug <> upper(toolkit_slug) or toolkit_slug like '%-%';

comment on table public.app_integration_registry is
  'Operator-only connector catalog (Composio toolkit slug + kind + visible). RLS is deny-all on purpose: no policy, ever. Server reads it with the service-role client and filters on visible before rendering.';
