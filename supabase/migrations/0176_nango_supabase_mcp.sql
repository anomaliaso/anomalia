-- 0176 — Seed Supabase MCP OAuth as a visible MCP connector.

insert into public.nango_integration_registry (unique_key, kind, visible)
values ('supabase-mcp-oauth', 'mcp', true)
on conflict (unique_key) do update
  set kind = excluded.kind,
      visible = excluded.visible,
      updated_at = now();
