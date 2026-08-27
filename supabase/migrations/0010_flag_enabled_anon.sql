-- 0010: let the public landing read the waitlist flag (anonymous visitors).
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-03 via MCP.
grant execute on function public.flag_enabled(text, boolean) to anon;
