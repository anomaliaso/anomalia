-- 0120 — one usage counter, not two.
-- Two parallel sessions each added prompt-usage tracking: use_count/bump_memory_usage (0118) and
-- times_used/bump_brand_memory_usage. Two counters means every consumer has to guess which one is
-- authoritative, and runDream decays on the wrong signal. times_used wins (more consumers).

update public.brand_memory
   set times_used = greatest(coalesce(times_used, 0), coalesce(use_count, 0))
 where coalesce(use_count, 0) > coalesce(times_used, 0);

alter table public.brand_memory drop column if exists use_count;
drop function if exists public.bump_memory_usage(uuid[]);
