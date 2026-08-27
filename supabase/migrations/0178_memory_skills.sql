-- 0178: skills — brand memory entries that hold a repeatable PROCEDURE, not a one-line fact.
--
-- A skill is deliberately not a new table: it is a longer value under a new category, so it
-- inherits everything brand_memory already does (per-brand RLS, confidence, decay in runDream,
-- the add_memory/read_memory tools, the Knowledge UI). The value is markdown whose FIRST LINE is
-- the trigger ("when to use this"); the rest is the steps.
--
-- Only the trigger line is injected into prompts — the chat system prompt already runs ~48k
-- tokens and is cache-prefix sensitive, so bodies are pulled on demand with read_memory.
--
-- Written either by the user (Knowledge > new memory) or by the AI itself, when runDream finds
-- three-plus lessons describing the same recurring procedure.

alter table public.brand_memory drop constraint if exists brand_memory_category_check;
alter table public.brand_memory add constraint brand_memory_category_check
  check (category in ('voice', 'constraint', 'fact', 'preference', 'insight', 'skill'));
