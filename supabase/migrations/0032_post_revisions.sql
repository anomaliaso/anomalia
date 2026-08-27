-- Per-post revision budget. Each user-feedback regeneration (approvals/regenerate) costs a
-- Gemini call + an image render, so we cap it at MAX_REVISIONS (3, enforced in the endpoint).
-- Cumulative count of revisions already spent on this post; never reset (a post's budget is
-- for its whole lifetime, not per month — the monthly cap lives on brand_usage instead).
alter table public.posts
  add column if not exists revisions_count int not null default 0;
