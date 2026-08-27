-- Cross-posting: a post may be published to several platforms at once (same caption + media —
-- "dumb" cross-post). `platform` stays the primary one (drives the single image's aspect ratio and
-- the caption tone it was generated for + the main display icon). `platforms` is the full publish
-- target set; NULL/empty falls back to [platform] so every existing post and the autopilot path keep
-- their current single-platform behaviour untouched.
alter table public.posts
  add column if not exists platforms text[];
