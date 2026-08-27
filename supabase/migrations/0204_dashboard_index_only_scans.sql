-- 0204 dashboard: turn the hot badge/overview counts into index-only scans.
--
-- Follow-up to 0164. That migration gave the hot tables a (brand_id, …) btree, which stopped
-- the seq scans — but every dashboard count still visited the heap, and on this instance a
-- heap visit is expensive: prod EXPLAIN showed the Leads badge
--
--   select count(*) from brand_news_items
--    where brand_id = $1 and status = 'suggested' and suggestion is not null
--
-- taking **1389 ms** (3399 buffers, "Rows Removed by Filter: 6298") — the single most
-- expensive statement in the database by total time (13.7k calls × 132 ms mean, 7.5 s worst).
-- It runs on EVERY /app/[brand] navigation, from the layout's deferred badge bundle.
--
-- Two things were wrong, and both have to be fixed for the count to be cheap:
--
-- 1. No index matched the predicate, so Postgres scanned every row of the brand and filtered
--    82% of them away. The rows are wide (snippet ~641 B, suggestion ~566 B, dm_draft ~416 B
--    → ~4 rows/page), so "the brand's rows" is thousands of pages.
--
-- 2. Even the right index was not enough on its own. brand_news_items is insert-heavy and
--    autovacuum's INSERT trigger is 20% of the table (autovacuum_vacuum_insert_scale_factor),
--    so it had not run for **7 days**. A stale visibility map turns an Index Only Scan into
--    918 heap fetches, which measured 680 ms — still unusable.
--
-- With the partial index AND a fresh visibility map the same count is **0.44 ms**
-- (4 buffers, Heap Fetches: 0). That is the pair this migration ships: the partial indexes
-- below, plus per-table autovacuum settings aggressive enough to keep the visibility map
-- fresh so the index-only scans stay index-only.
--
-- Applied to Supabase kszazivzwievqixcnanp on 2026-08-20 via MCP, recorded there as
-- version 20260820153905 (Supabase tracks by timestamp, so this file number is repo
-- ordering only). Numbered 0204 because 0202/0203 were taken by agent_template_avatar_faces
-- and chat_artifacts while this was in flight.

-- ── brand_news_items: Leads badge + Overview leads panel ─────────────────────────
-- Layout deferred `leadsPendingCount` (count) — 1389 ms → 0.44 ms.
create index if not exists brand_news_items_leads_pending_idx
  on public.brand_news_items (brand_id)
  where status = 'suggested' and suggestion is not null;

-- The /leads queue (200 newest with a suggestion) and Overview's `leadRows` count.
-- Ordering by created_at inside the index is the point: the obvious (brand_id, status)
-- index made the planner read all ~1358 matching rows — wide ones, `suggestion` included —
-- and top-N sort them, 376 ms. Walking newest-first stops after 200 heap fetches: 149 ms,
-- 970 buffers → 173. status rides along as an INCLUDE column so the status filter is
-- checked from the index (and Overview's status-only read stays index-only, 254 → ~5 ms
-- once the visibility map is warm).
--
-- Deliberately the ONLY index for this predicate: with a (brand_id, status) partial index
-- also present the planner picked that one and re-introduced the sort. Partial-index
-- selectivity is double-counted here (est. 197 rows vs 1358 actual), so it cannot cost the
-- two plans correctly — leaving one good index is what makes the choice right.
create index if not exists brand_news_items_leads_recent_idx
  on public.brand_news_items (brand_id, created_at desc) include (status)
  where suggestion is not null;

-- ── posts: quota counter + attention/radar badges ────────────────────────────────
-- usage.remaining(): posts created this month, excluding failed. Runs on every navigation
-- (layout deferred) and again on /plan, /calendar, /editorial.
create index if not exists posts_brand_created_billable_idx
  on public.posts (brand_id, created_at)
  where status <> 'failed';

-- Layout `attentionPostCount` (brand_id + needs_attention) and `radarReviewCount`
-- (…+ source = 'radar'), plus the same radar count inside Overview and Automations.
-- source lives in the index so both counts are index-only.
create index if not exists posts_brand_attention_idx
  on public.posts (brand_id, source)
  where needs_attention = true and status <> 'published';

-- Overview review queue + /content list: newest-first within a status, no sort step.
create index if not exists posts_brand_status_created_idx
  on public.posts (brand_id, status, created_at desc);

-- ── social_post_history: "stats updated at" ──────────────────────────────────────
-- Overview reads the newest synced_at. Without this it walks (brand_id, published_at desc)
-- and sorts; the partial index answers it from the first entry.
create index if not exists social_post_history_brand_synced_idx
  on public.social_post_history (brand_id, synced_at desc)
  where synced_at is not null;

-- ── brand_articles: scheduled blog previews ──────────────────────────────────────
-- Overview asks twice (preview rows + count) for approved articles with a future slot.
create index if not exists brand_articles_brand_upcoming_idx
  on public.brand_articles (brand_id, scheduled_for)
  where status = 'approved' and scheduled_for is not null;

-- ── video_reviews: media-review mix on Overview ──────────────────────────────────
-- loadMediaReviewStats orders by updated_at with NO status filter, so the existing
-- ready-only partial index does not apply and the query sorted the brand's rows.
create index if not exists video_reviews_brand_updated_idx
  on public.video_reviews (brand_id, updated_at desc);

-- ── ai_calls: credits (sum_brand_ai_cost_usd) ────────────────────────────────────
-- The RPC from 0164 averages 107 ms because the index carries the key but not the value,
-- so every matching row is a heap fetch. INCLUDE the summed column and the whole sum is
-- index-only. Same index also covers the chat rate-limiter's cost window (26.5k calls).
drop index if exists public.ai_calls_brand_created_cost_idx;
create index if not exists ai_calls_brand_created_cost_idx
  on public.ai_calls (brand_id, created_at) include (cost_usd)
  where cost_usd is not null;

-- ── Keep the visibility map fresh ────────────────────────────────────────────────
-- Everything above is an index-only scan ONLY while the visibility map is current. The
-- defaults (vacuum at 20% dead, insert-vacuum at 20% inserted, analyze at 10% changed) let
-- these tables go days between vacuums, which silently reverts every count to heap fetches —
-- that is how a 0.44 ms count became 1389 ms. These per-table settings trade a little more
-- background vacuum for counts that stay fast between runs.
alter table public.brand_news_items set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

alter table public.posts set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

alter table public.ai_calls set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

alter table public.social_post_history set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

alter table public.brand_articles set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

alter table public.video_reviews set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

-- Seed the visibility map now — the new indexes are useless until the first vacuum,
-- and autovacuum would not reach these tables for days on the default thresholds.
vacuum (analyze) public.brand_news_items;
vacuum (analyze) public.posts;
vacuum (analyze) public.ai_calls;
vacuum (analyze) public.social_post_history;
vacuum (analyze) public.brand_articles;
vacuum (analyze) public.video_reviews;
