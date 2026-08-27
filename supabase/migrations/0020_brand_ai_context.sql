-- 0020 brand_kit.ai_context: synthesized brand context (voice, themes, what performs, key
-- facts) injected into the generation prompt. Rebuilt by rebuildBrandContext() on save.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-04 via MCP.
alter table public.brand_kit add column if not exists ai_context text;
alter table public.brand_kit add column if not exists ai_context_updated_at timestamptz;
