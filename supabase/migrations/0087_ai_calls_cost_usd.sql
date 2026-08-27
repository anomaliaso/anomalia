-- Cost in USD of each AI call, computed at insert time in ai-log.ts from token usage and the
-- per-model price list (Gemini 3.5 Flash text, Nano Banana Pro images). NULL = not computable
-- (failed call, missing usage, or unknown-priced provider like Xiaomi).
alter table ai_calls add column if not exists cost_usd numeric(12, 6);
