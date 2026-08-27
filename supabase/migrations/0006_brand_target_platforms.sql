-- 0006: platforms the user INTENDS to connect (chosen in onboarding; real connection only after payment).
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-03 via MCP.
alter table public.brands add column if not exists target_platforms text[];
alter table public.brands add column if not exists activated_at timestamptz;
