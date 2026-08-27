-- 0025: remember which product each generated post features, for user context in the UI
-- (and to re-pass the product photo on regenerate). The planner already returns the verbatim
-- product name; we store it as text (loose link — survives product renames/deletes).
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-04 via MCP.
alter table public.posts add column if not exists product_name text;
