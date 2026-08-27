-- 0102 Multi-agent chat: bind each thread to a specialized agent
--
-- The free-mode chat becomes multi-agent: at thread creation the user picks ONE specialized
-- agent (strategist, content, analytics, seo, brand) that scopes the system prompt and the tool
-- set for the whole conversation — like switching model on Claude. The choice lives on the thread.
--
-- NULL agent = legacy thread (created before this feature) OR an onboarding thread → treated as
-- "full toolset" (the previous omni behavior), so nothing regresses and onboarding is untouched.

alter table chat_threads add column agent text;
