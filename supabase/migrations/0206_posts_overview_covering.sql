-- 0206 Overview: one index-only read in place of four brand-scoped post counts.
--
-- 0204 made each dashboard count individually cheap (index-only, sub-millisecond). What it
-- could not fix is that Overview asked for four of them separately — pending, scheduled,
-- published, radar-needs-review — plus two preview reads, six round trips to `posts` for one
-- screen. On a one-vCPU Postgres the cost that dominates is no longer execution but
-- per-request planning (10–20 ms measured per PostgREST call) and the contention between
-- concurrent requests for the same core, so six cheap queries still cost more than one.
--
-- loadHomeOverview now reads the four columns once and counts in JS. This index INCLUDEs
-- exactly those columns so that read touches no heap:
--
--   Index Only Scan using posts_brand_overview_idx  (actual time=4.167..4.183 rows=96)
--     Heap Fetches: 0
--     Buffers: shared hit=1 read=2
--
-- INCLUDE rather than a composite key on purpose: these columns are payload, never search
-- keys. Keeping them out of the key leaves the b-tree ordered by brand_id alone — smaller
-- inner pages, and no implied ordering for the planner to be tempted by.
--
-- Applied to Supabase kszazivzwievqixcnanp on 2026-08-20 via MCP. Numbered 0206 because
-- 0205 was taken by agent_sessions and chat_goal_events while this was in flight;
-- Supabase tracks by timestamp, so the file number is repo ordering only.
create index if not exists posts_brand_overview_idx
  on public.posts (brand_id)
  include (status, scheduled_for, source, needs_attention);
