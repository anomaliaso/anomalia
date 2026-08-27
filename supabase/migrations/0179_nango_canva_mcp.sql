-- 0179 — Seed Canva MCP as a visible MCP connector (mirrors 0176).

insert into public.nango_integration_registry (unique_key, kind, visible)
values ('canva-mcp', 'mcp', true)
on conflict (unique_key) do update
  set kind = excluded.kind,
      visible = excluded.visible,
      updated_at = now();
