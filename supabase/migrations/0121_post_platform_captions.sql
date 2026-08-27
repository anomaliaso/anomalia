-- Per-platform caption overrides: the same post can carry a short cut for X (280) and Threads
-- (500) next to its main caption. Shape: {"x": "...", "threads": "..."} — a missing/empty key
-- publishes the main caption, so every existing post keeps its current behaviour.
alter table public.posts
  add column if not exists platform_captions jsonb;
